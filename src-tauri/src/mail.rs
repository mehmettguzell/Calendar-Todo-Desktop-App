//! Reading the mailbox the bank sends transaction notifications to.
//!
//! This is the native half of the automatic spending feed. It does exactly two
//! things and deliberately no more: it fetches messages, and it keeps the
//! mailbox password out of the application's own data file. Deciding what a
//! message *means* — whether it is a purchase, for how much, at which shop — is
//! the frontend's job, because those rules are the ones that will need changing
//! the week a bank rewords its template, and a rule in Rust is a rule behind a
//! recompile.
//!
//! Two decisions are worth stating outright:
//!
//!  * **The password lives in the OS credential store.** The rest of the app is
//!    a plain JSON document in `Documents`, which is the right place for tasks
//!    and the wrong place for a password that would also unlock a mailbox in
//!    every backup that document has ever been part of.
//!  * **Nothing is ever marked read, moved or deleted.** The mailbox belongs to
//!    the user, and a sync that mutates it is a sync you cannot safely run
//!    twice. Progress is tracked by remembering the highest UID instead.

use std::time::Duration;

use mailparse::{MailHeaderMap, ParsedMail};
use serde::{Deserialize, Serialize};

/// Where the credential store files the password.
const KEYRING_SERVICE: &str = "tempo-mail";

/// A ceiling on one fetch, so a first run against a years-old mailbox cannot
/// pull tens of thousands of messages into the webview in one go.
const MAX_MESSAGES: usize = 200;

const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    /// TLS from the first byte (993). Otherwise STARTTLS is negotiated (143).
    pub secure: bool,
    pub username: String,
    pub folder: String,
    /// Addresses or domains worth reading. Empty means the whole folder.
    #[serde(default)]
    pub senders: Vec<String>,
    /// Highest UID already handed to the frontend.
    #[serde(default)]
    pub last_uid: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessageDto {
    pub uid: String,
    pub from: String,
    pub subject: String,
    pub body: String,
    pub received_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailFetchResult {
    pub messages: Vec<MailMessageDto>,
    /// The new high-water mark, to be stored and sent back next time.
    pub last_uid: u32,
    /// How many the server offered, before the sender filter and the ceiling.
    pub examined: usize,
    /// True when the ceiling cut the batch short, so the caller can poll again.
    pub more: bool,
}

/* ------------------------------------------------------------------ */
/* The password                                                        */
/* ------------------------------------------------------------------ */

fn entry(username: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, username).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mail_set_password(username: String, password: String) -> Result<(), String> {
    entry(&username)?
        .set_password(&password)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mail_has_password(username: String) -> bool {
    entry(&username)
        .map(|slot| slot.get_password().is_ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn mail_clear_password(username: String) -> Result<(), String> {
    match entry(&username)?.delete_credential() {
        Ok(()) => Ok(()),
        // Clearing something that was never stored is the state the caller
        // asked for, not a failure they can act on.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/* ------------------------------------------------------------------ */
/* Turning a MIME message into text                                    */
/* ------------------------------------------------------------------ */

/// Flatten HTML to something the parser can read.
///
/// Not an HTML parser and not trying to be: bank notification mail is a table
/// wrapped around one sentence, and all the sentence needs is for the tags to
/// become spaces without gluing two words together.
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut depth = 0usize;
    let mut skipping: Option<&'static str> = None;
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        // <script> and <style> carry text that is not the message.
        if skipping.is_none() {
            for tag in ["script", "style"] {
                let open = format!("<{tag}");
                if lower[index..].starts_with(&open) {
                    skipping = Some(if tag == "script" { "</script" } else { "</style" });
                    break;
                }
            }
        }
        if let Some(close) = skipping {
            if lower[index..].starts_with(close) {
                skipping = None;
                depth = 1; // fall through the tag itself
            }
            index += 1;
            continue;
        }

        let char = bytes[index] as char;
        if char == '<' {
            depth += 1;
            out.push(' ');
        } else if char == '>' {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            out.push(char);
        }
        index += 1;
    }

    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#8217;", "’");

    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The readable body of a message, preferring plain text over HTML.
fn body_of(mail: &ParsedMail<'_>) -> String {
    let mime = mail.ctype.mimetype.to_ascii_lowercase();

    if mail.subparts.is_empty() {
        let text = mail.get_body().unwrap_or_default();
        return if mime.contains("html") {
            html_to_text(&text)
        } else {
            text
        };
    }

    // A multipart/alternative carries the same message twice. The plain part is
    // the one written for reading, so it is tried first across the whole tree.
    for part in &mail.subparts {
        if part.ctype.mimetype.eq_ignore_ascii_case("text/plain") {
            let text = part.get_body().unwrap_or_default();
            if !text.trim().is_empty() {
                return text;
            }
        }
    }
    for part in &mail.subparts {
        let text = body_of(part);
        if !text.trim().is_empty() {
            return text;
        }
    }
    String::new()
}

/// `Date:` as an ISO-8601 instant, falling back to now when it is unreadable.
fn received_at(mail: &ParsedMail<'_>) -> String {
    let raw = mail.headers.get_first_value("Date").unwrap_or_default();
    match mailparse::dateparse(&raw) {
        Ok(seconds) => format_epoch(seconds),
        Err(_) => format_epoch(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        ),
    }
}

/// Seconds since the epoch as `YYYY-MM-DDTHH:MM:SS.000Z`.
///
/// Written out by hand rather than pulling in a date library for one format:
/// the frontend parses this with `new Date(...)`, which needs the offset to be
/// explicit, and nothing else here cares about calendars.
fn format_epoch(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    let (hour, minute, second) = (time / 3600, (time % 3600) / 60, time % 60);

    // Civil-from-days, the standard algorithm; correct for every proleptic
    // Gregorian date rather than only the ones near today.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

/// Whether a sender is one the user asked to read.
///
/// Matched as a substring of the whole `From` header so that both a full
/// address and a bare domain work — "@garantibbva.com.tr" is the useful form,
/// because banks send from a different local part every quarter.
fn wanted_sender(from: &str, senders: &[String]) -> bool {
    if senders.is_empty() {
        return true;
    }
    let haystack = from.to_ascii_lowercase();
    senders
        .iter()
        .any(|sender| !sender.trim().is_empty() && haystack.contains(&sender.trim().to_ascii_lowercase()))
}

/* ------------------------------------------------------------------ */
/* The fetch                                                           */
/* ------------------------------------------------------------------ */

/// Connect, read, disconnect.
///
/// Kept synchronous and self-contained; the command below is what moves it off
/// the UI thread. A session is opened per poll rather than held open, because a
/// long-lived IMAP connection on a laptop that sleeps is a connection that is
/// silently dead at exactly the moment it is needed.
fn fetch_blocking(config: MailConfig, password: String) -> Result<MailFetchResult, String> {
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|error| format!("TLS: {error}"))?;

    let client = if config.secure {
        imap::connect((config.host.as_str(), config.port), config.host.as_str(), &tls)
            .map_err(|error| format!("{error}"))?
    } else {
        let stream = std::net::TcpStream::connect((config.host.as_str(), config.port))
            .map_err(|error| format!("{error}"))?;
        stream.set_read_timeout(Some(TIMEOUT)).ok();
        stream.set_write_timeout(Some(TIMEOUT)).ok();
        imap::Client::new(stream)
            .secure(config.host.as_str(), &tls)
            .map_err(|error| format!("STARTTLS: {error}"))?
    };

    let mut session = client
        .login(&config.username, &password)
        // The tuple carries the client back; only the reason is useful here.
        .map_err(|(error, _)| format!("{error}"))?;

    let result = (|| -> Result<MailFetchResult, String> {
        session
            .select(&config.folder)
            .map_err(|error| format!("{}: {error}", config.folder))?;

        /*
         * What to ask for.
         *
         * With a high-water mark, everything above it. Without one — the first
         * ever run — the last week only: a mailbox that has been collecting
         * bank mail for years would otherwise import a history the user never
         * asked for, and every one of those entries would be unmatched.
         */
        let query = match config.last_uid {
            Some(uid) => format!("UID {}:*", uid.saturating_add(1)),
            None => since_last_week(),
        };

        let uids = session
            .uid_search(&query)
            .map_err(|error| format!("{error}"))?;

        let mut sorted: Vec<u32> = uids.into_iter().collect();
        sorted.sort_unstable();
        // `UID n:*` always returns at least one message even when nothing is
        // newer than n, because the server clamps the range to the last UID.
        if let Some(mark) = config.last_uid {
            sorted.retain(|uid| *uid > mark);
        }

        let examined = sorted.len();
        let more = examined > MAX_MESSAGES;
        sorted.truncate(MAX_MESSAGES);

        let mut messages = Vec::new();
        let mut high_water = config.last_uid.unwrap_or(0);

        for uid in sorted {
            high_water = high_water.max(uid);
            let fetched = session
                .uid_fetch(uid.to_string(), "BODY.PEEK[]")
                .map_err(|error| format!("{error}"))?;

            for item in fetched.iter() {
                let Some(raw) = item.body().or_else(|| item.text()) else {
                    continue;
                };
                let Ok(parsed) = mailparse::parse_mail(raw) else {
                    continue;
                };

                let from = parsed.headers.get_first_value("From").unwrap_or_default();
                if !wanted_sender(&from, &config.senders) {
                    continue;
                }

                messages.push(MailMessageDto {
                    uid: uid.to_string(),
                    from,
                    subject: parsed.headers.get_first_value("Subject").unwrap_or_default(),
                    body: body_of(&parsed),
                    received_at: received_at(&parsed),
                });
            }
        }

        Ok(MailFetchResult {
            messages,
            last_uid: high_water,
            examined,
            more,
        })
    })();

    // Log out whatever happened; leaving a session open costs the user a
    // connection slot on a server they share with their phone.
    let _ = session.logout();
    result
}

/// `SINCE dd-Mon-yyyy` for a week ago, in the form IMAP insists on.
fn since_last_week() -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        - 7 * 86_400;
    let stamp = format_epoch(seconds);
    let year = &stamp[0..4];
    let month: usize = stamp[5..7].parse().unwrap_or(1);
    let day: u32 = stamp[8..10].parse().unwrap_or(1);
    format!(
        "SINCE {}-{}-{}",
        day,
        MONTHS.get(month.saturating_sub(1)).copied().unwrap_or("Jan"),
        year
    )
}

/// Read new messages from the configured mailbox.
///
/// `spawn_blocking` matters: a Tauri command that blocks runs on a thread the
/// webview is waiting on, and an unreachable mail server would freeze the whole
/// window for the length of the TCP timeout.
#[tauri::command]
pub async fn mail_fetch(config: MailConfig) -> Result<MailFetchResult, String> {
    let password = entry(&config.username)?
        .get_password()
        .map_err(|_| "no-password".to_string())?;

    tauri::async_runtime::spawn_blocking(move || fetch_blocking(config, password))
        .await
        .map_err(|error| error.to_string())?
}

/// Connect and log in, without reading anything.
///
/// The "Test" button in Settings. Credentials that are wrong should say so at
/// the moment they are typed, not by leaving the feed quietly empty for a week.
#[tauri::command]
pub async fn mail_probe(config: MailConfig) -> Result<String, String> {
    let password = entry(&config.username)?
        .get_password()
        .map_err(|_| "no-password".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|error| format!("TLS: {error}"))?;
        let client = if config.secure {
            imap::connect((config.host.as_str(), config.port), config.host.as_str(), &tls)
                .map_err(|error| format!("{error}"))?
        } else {
            let stream = std::net::TcpStream::connect((config.host.as_str(), config.port))
                .map_err(|error| format!("{error}"))?;
            imap::Client::new(stream)
                .secure(config.host.as_str(), &tls)
                .map_err(|error| format!("STARTTLS: {error}"))?
        };
        let mut session = client
            .login(&config.username, &password)
            .map_err(|(error, _)| format!("{error}"))?;
        let mailbox = session
            .select(&config.folder)
            .map_err(|error| format!("{}: {error}", config.folder))?;
        let _ = session.logout();
        Ok(format!("{}", mailbox.exists))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_without_gluing_words_together() {
        let html = "<p>MIGROS</p><p>250,00 TL</p><style>p{color:red}</style>";
        assert_eq!(html_to_text(html), "MIGROS 250,00 TL");
    }

    #[test]
    fn decodes_the_entities_a_bank_actually_uses() {
        assert_eq!(html_to_text("A&nbsp;&amp;&nbsp;B"), "A & B");
    }

    #[test]
    fn formats_an_instant_the_frontend_can_parse() {
        // 2026-08-25T11:35:00Z
        assert_eq!(format_epoch(1_787_657_700), "2026-08-25T11:35:00.000Z");
    }

    #[test]
    fn an_empty_sender_list_reads_the_whole_folder() {
        assert!(wanted_sender("Bank <a@b.com>", &[]));
    }

    #[test]
    fn matches_a_bare_domain() {
        let senders = vec!["@garantibbva.com.tr".to_string()];
        assert!(wanted_sender(
            "Garanti BBVA <bilgilendirme@garantibbva.com.tr>",
            &senders
        ));
        assert!(!wanted_sender("Someone <a@example.com>", &senders));
    }
}

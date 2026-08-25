import { invoke } from "@tauri-apps/api/core";
import type { MailMessage } from "@/domain/bankAlert";
import type { MailSyncSettings } from "@/domain/types";
import { isTauri } from "@/lib/env";

/**
 * The mailbox the bank's notification messages land in.
 *
 * Everything here is a thin wrapper over a native command: reading mail needs a
 * socket and a credential store, and a webview has neither. What the messages
 * *mean* is decided in `domain/bankAlert`, on purpose — those rules change the
 * week a bank rewords its template, and a rule behind a recompile is a rule
 * nobody fixes.
 */

export interface MailFetchResult {
  messages: MailMessage[];
  /** The new high-water mark, to be stored and sent back next time. */
  lastUid: number;
  examined: number;
  /** The batch was capped; poll again to continue. */
  more: boolean;
}

/** The part of the settings the native side needs, and nothing more. */
function payload(config: MailSyncSettings) {
  return {
    host: config.host.trim(),
    port: config.port,
    secure: config.secure,
    username: config.username.trim(),
    folder: config.folder.trim() || "INBOX",
    senders: config.senders.map((sender) => sender.trim()).filter(Boolean),
    lastUid: config.lastUid ?? null,
  };
}

export class MailError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "MailError";
  }
}

const UNSUPPORTED = "Mail sync needs the desktop app.";

export async function fetchMail(config: MailSyncSettings): Promise<MailFetchResult> {
  if (!isTauri()) throw new MailError(UNSUPPORTED);
  try {
    return await invoke<MailFetchResult>("mail_fetch", { config: payload(config) });
  } catch (error) {
    throw new MailError(String(error));
  }
}

/** Connect and log in without reading anything: the "Test" button. */
export async function probeMail(config: MailSyncSettings): Promise<number> {
  if (!isTauri()) throw new MailError(UNSUPPORTED);
  try {
    return Number(await invoke<string>("mail_probe", { config: payload(config) }));
  } catch (error) {
    throw new MailError(String(error));
  }
}

export async function setMailPassword(username: string, password: string): Promise<void> {
  if (!isTauri()) throw new MailError(UNSUPPORTED);
  await invoke("mail_set_password", { username: username.trim(), password });
}

export async function hasMailPassword(username: string): Promise<boolean> {
  if (!isTauri() || !username.trim()) return false;
  return invoke<boolean>("mail_has_password", { username: username.trim() }).catch(
    () => false,
  );
}

export async function clearMailPassword(username: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("mail_clear_password", { username: username.trim() }).catch(
    () => undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Getting someone connected                                           */
/* ------------------------------------------------------------------ */

export interface MailPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  /**
   * Whether the provider requires a purpose-made password.
   *
   * Every one of these refuses an ordinary account password over IMAP once
   * two-factor sign-in is on, and "wrong credentials" is not a message anyone
   * can act on without being told this first.
   */
  appPassword: boolean;
}

export const MAIL_PRESETS: MailPreset[] = [
  { id: "gmail", label: "Gmail", host: "imap.gmail.com", port: 993, secure: true, appPassword: true },
  { id: "outlook", label: "Outlook", host: "outlook.office365.com", port: 993, secure: true, appPassword: true },
  { id: "yandex", label: "Yandex", host: "imap.yandex.com.tr", port: 993, secure: true, appPassword: true },
  { id: "icloud", label: "iCloud", host: "imap.mail.me.com", port: 993, secure: true, appPassword: true },
];

/**
 * Sender filters worth suggesting, per bank.
 *
 * Domains rather than addresses: banks change the local part every time they
 * change mail vendor, and a filter that stops matching stops the feed without
 * ever saying so.
 */
export const BANK_SENDERS: { id: string; label: string; domains: string[] }[] = [
  { id: "ziraat", label: "Ziraat Bankası", domains: ["@ziraatbank.com.tr"] },
  { id: "isbank", label: "İş Bankası", domains: ["@isbank.com.tr", "@maximum.com.tr"] },
  {
    id: "garanti",
    label: "Garanti BBVA",
    domains: ["@garantibbva.com.tr", "@garanti.com.tr", "@bonus.com.tr"],
  },
  {
    id: "yapikredi",
    label: "Yapı Kredi",
    domains: ["@yapikredi.com.tr", "@worldcard.com.tr"],
  },
];

export const DEFAULT_MAIL_SYNC: MailSyncSettings = {
  enabled: false,
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  username: "",
  folder: "INBOX",
  senders: [],
  everyMinutes: 15,
  autoRecord: true,
  lastUid: null,
  lastSyncAt: null,
  lastError: null,
};

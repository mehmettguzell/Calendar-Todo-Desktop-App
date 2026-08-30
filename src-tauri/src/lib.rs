mod mail;

use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The event the frontend listens for to open its capture box.
const QUICK_CAPTURE_EVENT: &str = "tempo://quick-capture";

/// The same idea for money: log a spend without first finding the window.
///
/// A separate event rather than a mode on the task one, because the two are
/// reached at different moments and neither should cost a detour through the
/// other. A purchase logged three taps later is a purchase that does not get
/// logged.
const QUICK_SPEND_EVENT: &str = "tempo://quick-spend";

/// Tells the frontend to re-read the clock and deliver anything that is due.
const HEARTBEAT_EVENT: &str = "tempo://heartbeat";

/// How often that happens. Reminders are minute-accurate, so this only has to
/// be comfortably under a minute.
const HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// `Ctrl/Cmd + Shift + Space`, registered system-wide.
fn quick_capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Folder the user can actually find: `Documents/calendar`.
const FOLDER: &str = "calendar";
const FILE: &str = "calendar-data.json";
/// Namespace used before anyone signs in.
const ANONYMOUS: &str = "local";

/// Turn a namespace into a filename component that cannot escape the folder.
///
/// The namespace is a Supabase user id, but it arrives from the webview, so it
/// is treated as untrusted: anything outside `[A-Za-z0-9_-]` is dropped rather
/// than allowed to walk out of `Documents/calendar` via `..` or a separator.
fn sanitise(namespace: &str) -> String {
    let cleaned: String = namespace
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        ANONYMOUS.to_string()
    } else {
        cleaned
    }
}

/// Resolve the data file for one namespace, creating the folder if needed.
///
/// Every signed-in account gets its own file, so signing in as someone else on
/// a shared machine cannot show — or silently upload — the previous account's
/// tasks. The anonymous namespace keeps the original path so an existing
/// install finds its data exactly where it left it.
fn database_file(app: &tauri::AppHandle, namespace: Option<&str>) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not locate the Documents folder: {e}"))?;

    let folder = documents.join(FOLDER);
    fs::create_dir_all(&folder).map_err(|e| format!("Could not create {folder:?}: {e}"))?;

    let ns = sanitise(namespace.unwrap_or(ANONYMOUS));
    if ns == ANONYMOUS {
        Ok(folder.join(FILE))
    } else {
        Ok(folder.join(format!("calendar-data-{ns}.json")))
    }
}

/// Where the data lives, for display in Settings.
#[tauri::command]
fn database_path(app: tauri::AppHandle, namespace: Option<String>) -> Result<String, String> {
    Ok(database_file(&app, namespace.as_deref())?
        .to_string_lossy()
        .into_owned())
}

/// Read the saved document. `None` on a first run, which the frontend seeds.
#[tauri::command]
fn load_database(app: tauri::AppHandle, namespace: Option<String>) -> Result<Option<String>, String> {
    let path = database_file(&app, namespace.as_deref())?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {path:?}: {e}"))
}

/// Write the document.
///
/// The write goes to a sibling temp file first and is then renamed over the
/// target, so a crash mid-write cannot leave a half-written task list behind.
#[tauri::command]
fn save_database(
    app: tauri::AppHandle,
    contents: String,
    namespace: Option<String>,
) -> Result<(), String> {
    let path = database_file(&app, namespace.as_deref())?;
    let temp = path.with_extension("json.tmp");

    fs::write(&temp, contents).map_err(|e| format!("Could not write {temp:?}: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace {path:?}: {e}"))?;
    Ok(())
}

/// Delete one namespace's data file. Used when a local document has been
/// handed over to the account that just signed in for the first time.
#[tauri::command]
fn clear_database(app: tauri::AppHandle, namespace: Option<String>) -> Result<(), String> {
    let path = database_file(&app, namespace.as_deref())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Could not remove {path:?}: {e}"))?;
    }
    Ok(())
}

/// Show a desktop notification and say whether the OS actually took it.
///
/// The notification plugin fires its toast on a detached task and drops the
/// result, so a toast Windows refused looks exactly like one it displayed.
/// That is the difference between "notifications do not work" being a mystery
/// and being a message, so this path keeps the error.
#[cfg_attr(not(windows), allow(unused_variables))]
#[tauri::command]
async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification.summary(&title).body(&body);

    // Windows draws the toast's name and icon from an AppUserModelID, and ours
    // only exists once the installer has registered a Start menu shortcut.
    // Claiming it while running out of `target/` produces no toast at all, so
    // there we leave it unset and notify-rust falls back to an id that is
    // always registered.
    #[cfg(windows)]
    {
        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        // `.../target/debug/tempo.exe` and `.../target/release/tempo.exe`.
        let running_from_build_output = exe.parent().is_some_and(|dir| {
            matches!(
                dir.file_name().and_then(|n| n.to_str()),
                Some("debug" | "release")
            ) && dir.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) == Some("target")
        });
        if !running_from_build_output {
            notification.app_id(&app.config().identifier);
        }
    }

    notification
        .show()
        .map(|_| ())
        .map_err(|e| format!("Windows refused the notification: {e}"))
}

/// Bring the main window to the foreground; the notification "Open" path.
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    reveal(&app);
}

/// Show and focus the main window, wherever it was hidden or minimised to.
fn reveal(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Quit for real, rather than hiding to the tray.
///
/// Separate from the window's close button on purpose: closing a window is the
/// most reflexive action there is, and if it also stopped every reminder the
/// user set, the feature would silently fail exactly when it was needed.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Whether the app currently starts with the system.
#[tauri::command]
fn autostart_enabled(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turn "start with Windows" on or off, and report what it actually became.
///
/// Returns the resulting state rather than `()`: the registry write can fail on
/// a locked-down machine, and a switch that flips in the UI while nothing
/// changed on disk is worse than one that refuses to move.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| format!("Could not change the startup setting: {e}"))?;
    Ok(launcher.is_enabled().unwrap_or(enabled))
}

/// Drive the reminder clock from the host process, not from the webview.
///
/// A hidden window keeps running, but WebView2 throttles background timers —
/// which would turn a 20-second reminder check into a minute or more, at
/// exactly the moment it matters: when the app is closed to the tray and the
/// user is relying on it to speak up. A native thread is not throttled, so the
/// beat comes from here and the webview only reacts to it.
fn start_heartbeat(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(HEARTBEAT_INTERVAL);
        if app.emit(HEARTBEAT_EVENT, ()).is_err() {
            // The app is shutting down; nothing left to beat for.
            break;
        }
    });
}

/// The tray icon: what keeps the app alive once its window is gone.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Tempo'yu aç", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Hızlı görev ekle", true, None::<&str>)?;
    let spend = MenuItem::with_id(app, "spend", "Harcama ekle", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &spend, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("no default window icon".into())
        })?)
        .tooltip("Tempo — hatırlatıcılar arka planda çalışıyor")
        .menu(&menu)
        // The menu belongs to the right button; a left click should just open
        // the app, which is what every tray icon on Windows does.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => reveal(app),
            "capture" => {
                reveal(app);
                let _ = app.emit(QUICK_CAPTURE_EVENT, ());
            }
            "spend" => {
                reveal(app);
                let _ = app.emit(QUICK_SPEND_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // `--hidden` tells the frontend it was started by the system rather
            // than by a person, so it can come up in the tray instead of
            // throwing a window at someone who just logged in.
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Fire on press, not release: acting on both would open the
                    // capture box twice for one keystroke.
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &quick_capture_shortcut()
                    {
                        reveal(app);
                        let _ = app.emit(QUICK_CAPTURE_EVENT, ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Registered here rather than in the chain above because both are
            // desktop-only, and `setup` is the one place that can be made
            // conditional without splitting the whole builder in two.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            build_tray(app.handle())?;
            start_heartbeat(app.handle().clone());

            // A shortcut another app already owns is a warning, not a failure:
            // everything else still works without it.
            if let Err(error) = app
                .global_shortcut()
                .register(quick_capture_shortcut())
            {
                eprintln!("[tempo] global shortcut unavailable: {error}");
            }

            // Launched at login: stay in the tray until the user asks for it.
            if std::env::args().any(|arg| arg == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window must not stop the reminders. The webview
                // keeps running while hidden, which is what makes a reminder
                // set this morning still arrive this evening; "Çıkış" in the
                // tray menu is the way to actually leave.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            database_path,
            load_database,
            save_database,
            clear_database,
            show_notification,
            focus_main_window,
            quit_app,
            autostart_enabled,
            set_autostart,
            mail::mail_fetch,
            mail::mail_probe,
            mail::mail_set_password,
            mail::mail_has_password,
            mail::mail_clear_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

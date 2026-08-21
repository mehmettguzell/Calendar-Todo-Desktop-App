use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Folder the user can actually find: `Documents/calendar`.
const FOLDER: &str = "calendar";
const FILE: &str = "calendar-data.json";

/// Resolve `Documents/calendar/calendar-data.json`, creating the folder if needed.
fn database_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not locate the Documents folder: {e}"))?;

    let folder = documents.join(FOLDER);
    fs::create_dir_all(&folder).map_err(|e| format!("Could not create {folder:?}: {e}"))?;
    Ok(folder.join(FILE))
}

/// Where the data lives, for display in Settings.
#[tauri::command]
fn database_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(database_file(&app)?.to_string_lossy().into_owned())
}

/// Read the saved document. `None` on a first run, which the frontend seeds.
#[tauri::command]
fn load_database(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = database_file(&app)?;
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
fn save_database(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = database_file(&app)?;
    let temp = path.with_extension("json.tmp");

    fs::write(&temp, contents).map_err(|e| format!("Could not write {temp:?}: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace {path:?}: {e}"))?;
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            database_path,
            load_database,
            save_database,
            show_notification,
            focus_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

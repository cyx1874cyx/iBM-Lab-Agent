#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use std::sync::Arc;
use tauri::{Manager, WebviewWindow, WindowEvent};
use tauri_plugin_single_instance::init as single_instance;

use runtime::{AppConfig, RuntimeManager, RuntimeStatus};

struct AppState(Arc<RuntimeManager>);

fn show_runtime_error(window: &WebviewWindow, message: &str) {
    let payload = serde_json::to_string(message).unwrap_or_else(|_| "\"Unknown startup error\"".to_string());
    let _ = window.eval(&format!("window.ibmLabRuntimeFailed?.({payload})"));
}

fn start_runtime(app: tauri::AppHandle, runtime: Arc<RuntimeManager>) {
    std::thread::spawn(move || {
        let Some(window) = app.get_webview_window("main") else { return };
        let _ = window.eval("window.ibmLabRuntimeStarting?.()");
        match runtime.start() {
            Ok(url) => {
                let payload = serde_json::to_string(&url).unwrap_or_else(|_| "\"http://127.0.0.1\"".to_string());
                let _ = window.eval(&format!("window.ibmLabRuntimeReady?.({payload})"));
            }
            Err(error) => show_runtime_error(&window, &error.to_string()),
        }
    });
}

#[tauri::command]
fn restart_runtime(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.0.shutdown().map_err(|error| error.to_string())?;
    start_runtime(app, Arc::clone(&state.0));
    Ok(())
}

#[tauri::command]
fn open_logs(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.0.open_logs().map_err(|error| error.to_string())
}

#[tauri::command]
fn runtime_status(state: tauri::State<'_, AppState>) -> RuntimeStatus {
    state.0.status()
}

#[tauri::command]
fn load_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    state.0.load_config().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_config(config: AppConfig, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.0.save_config(config).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(single_instance(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let runtime = Arc::new(RuntimeManager::new(app.handle().clone()).map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?);
            app.manage(AppState(Arc::clone(&runtime)));
            start_runtime(app.handle().clone(), runtime);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let _ = state.0.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![restart_runtime, open_logs, runtime_status, load_config, save_config])
        .run(tauri::generate_context!())
        .expect("failed to run iBM Lab Agent");
}

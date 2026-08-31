#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use std::sync::Arc;
use tauri::{Manager, WebviewWindow, WindowEvent};
use tauri_plugin_single_instance::init as single_instance;

use runtime::{AppConfig, RuntimeDeps, RuntimeManager, RuntimeStatus, SavedArtifact};

struct AppState(Arc<RuntimeManager>);

fn show_runtime_error(window: &WebviewWindow, message: &str) {
    let payload =
        serde_json::to_string(message).unwrap_or_else(|_| "\"Unknown startup error\"".to_string());
    let _ = window.eval(&format!("window.ibmLabRuntimeFailed?.({payload})"));
}

fn start_runtime(app: tauri::AppHandle, runtime: Arc<RuntimeManager>) {
    std::thread::spawn(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.eval("window.ibmLabRuntimeStarting?.()");
        match runtime.start() {
            Ok(url) => {
                let payload = serde_json::to_string(&url)
                    .unwrap_or_else(|_| "\"http://127.0.0.1\"".to_string());
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
fn open_workspace(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.0.open_workspace().map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_artifact(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<SavedArtifact, String> {
    let runtime = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || runtime.save_artifact(&url))
        .await
        .map_err(|error| format!("Artifact save task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_path(path: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.0.open_path(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_path(path: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .reveal_path(&path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn runtime_status(state: tauri::State<'_, AppState>) -> RuntimeStatus {
    state.0.status()
}

/// P1-1 runtime dependency doctor：Edge/Python/Node/Bridge/Office 状态一屏可见。
#[tauri::command]
fn runtime_deps(state: tauri::State<'_, AppState>) -> RuntimeDeps {
    state.0.deps()
}

#[tauri::command]
fn load_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    state.0.load_config().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_config(config: AppConfig, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .save_config(config)
        .map_err(|error| error.to_string())
}

/// desktop-edge-handoff：在外部 Microsoft Edge 中打开 URL（URL Router）。
///
/// 放行两类地址，其余一律拒绝，防止桌面客户端被用作任意网页启动器：
///   1. loopback（127.0.0.1/localhost/[::1]）上的 /lab/capture/<id> capture handoff 页面；
///   2. https:// 外部机构/出版社入口（DOI 跳转、学校数据库入口等）。
#[tauri::command]
fn open_in_edge(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| format!("invalid url: {error}"))?;
    let is_loopback = match parsed.host_str() {
        Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1") => true,
        _ => false,
    };
    let allowed = if is_loopback && parsed.path().starts_with("/lab/capture/") {
        true
    } else {
        parsed.scheme() == "https" && parsed.host_str().is_some()
    };
    if !allowed {
        return Err("only loopback /lab/capture/ or https URLs are allowed".to_string());
    }
    let candidates = [
        std::path::PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        std::path::PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        std::env::var_os("LOCALAPPDATA")
            .map(|base| {
                std::path::PathBuf::from(base).join(r"Microsoft\Edge\Application\msedge.exe")
            })
            .unwrap_or_default(),
    ];
    let Some(edge) = candidates.iter().find(|path| path.is_file()) else {
        return Err("Microsoft Edge 未安装或未找到 msedge.exe".to_string());
    };
    let child = std::process::Command::new(edge)
        .arg("--new-window")
        .arg(&url)
        .spawn()
        .map_err(|error| format!("无法启动 Microsoft Edge: {error}"))?;
    drop(child); // 仅关闭进程句柄；不能 kill 启动器，否则冷启动时 Edge 可能来不及接管。
    Ok(())
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
            let runtime = Arc::new(
                RuntimeManager::new(app.handle().clone())
                    .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?,
            );
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
        .invoke_handler(tauri::generate_handler![
            restart_runtime,
            open_logs,
            open_workspace,
            save_artifact,
            open_path,
            reveal_path,
            runtime_status,
            runtime_deps,
            load_config,
            save_config,
            open_in_edge
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iBM Lab Agent");
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use std::sync::Arc;
use tauri::{Manager, WebviewWindow, WindowEvent};
use tauri_plugin_single_instance::init as single_instance;

use runtime::{AppMcpStatus, RuntimeDeps, RuntimeManager, RuntimeStatus, SavedArtifact};

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
async fn save_text_artifact(
    file_name: String,
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<SavedArtifact, String> {
    let runtime = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || runtime.save_text_artifact(&file_name, &text))
        .await
        .map_err(|error| format!("RIS save task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_artifact(url: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let runtime = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || runtime.open_artifact(&url))
        .await
        .map_err(|error| format!("Artifact open task failed: {error}"))?
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
fn pick_mcp_dir() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 MCP 服务目录")
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
async fn app_mcp_status(
    app_key: String,
    test_connection: bool,
    state: tauri::State<'_, AppState>,
) -> Result<AppMcpStatus, String> {
    let runtime = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || runtime.app_mcp_status(&app_key, test_connection))
        .await
        .map_err(|error| format!("MCP status task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_app_mcp(
    app_key: String,
    directory: String,
    enabled: bool,
    tool_profile: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<AppMcpStatus, String> {
    state
        .0
        .save_app_mcp(&app_key, &directory, enabled, tool_profile)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_app_mcp(app_key: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .remove_app_mcp(&app_key)
        .map_err(|error| error.to_string())
}

/// 准备 Origin MCP Bridge：调用捆绑 origin_mcp install-origin-app --force，
/// 输出 OPX 注册指令。命令只做 “准备”，不谎称 Bridge 已完成注册。
#[tauri::command]
fn install_origin_bridge(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state
        .0
        .install_origin_bridge()
        .map_err(|error| error.to_string())
}

/// desktop-edge-handoff：在外部 Microsoft Edge 中打开 URL（URL Router）。
///
/// 放行两类地址，其余一律拒绝，防止桌面客户端被用作任意网页启动器：
///   1. 当前本地运行时上的捕获页或已归档 PDF/SI 预览；
///   2. https:// 外部机构/出版社入口（DOI 跳转、学校数据库入口等）。
#[tauri::command]
fn open_in_edge(url: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| format!("invalid url: {error}"))?;
    let is_loopback = match parsed.host_str() {
        Some("127.0.0.1") | Some("localhost") | Some("[::1]") | Some("::1") => true,
        _ => false,
    };
    let capture_task_id = parsed.query_pairs().collect::<Vec<_>>();
    let capture_fragment = parsed
        .fragment()
        .map(|fragment| url::form_urlencoded::parse(fragment.as_bytes()).collect::<Vec<_>>())
        .unwrap_or_default();
    let valid_capture = parsed.scheme() == "http"
        && parsed.path() == "/lab/capture/"
        && capture_task_id.len() == 1
        && capture_task_id[0].0 == "taskId"
        && capture_task_id[0]
            .1
            .strip_prefix("capture-")
            .is_some_and(|suffix| {
                !suffix.is_empty()
                    && suffix
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            })
        && capture_fragment.len() == 1
        && capture_fragment[0].0 == "t"
        && !capture_fragment[0].1.is_empty();
    let artifact_query = parsed
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    let valid_artifact = parsed.scheme() == "http"
        && parsed.path() == "/api/lab-artifacts"
        && artifact_query.len() == 3
        && artifact_query
            .get("preview")
            .is_some_and(|value| value == "1")
        && artifact_query
            .get("kind")
            .is_some_and(|value| value == "pdf" || value == "si")
        && artifact_query.get("bundleId").is_some_and(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        });
    let runtime_port = state.0.status().port;
    let current_runtime = is_loopback && parsed.port_or_known_default() == runtime_port;
    let allowed = if current_runtime && (valid_capture || valid_artifact) {
        true
    } else {
        parsed.scheme() == "https" && parsed.host_str().is_some()
    };
    if !allowed {
        return Err(
            "only an authenticated loopback /lab/capture/ URL or an https URL is allowed"
                .to_string(),
        );
    }
    launch_edge(&url)
}

/// 校验打开请求：只允许 pdf/si，且 bundle 标识必须是受限字符集。
/// 单独抽成纯函数，便于单元测试覆盖注入与越界输入。
fn validate_open_request(kind: &str, bundle_id: &str) -> Result<(), String> {
    if kind != "pdf" && kind != "si" {
        return Err("文献类型必须是 pdf 或 si".to_string());
    }
    if bundle_id.is_empty()
        || bundle_id.len() > 128
        || !bundle_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("文献标识无效".to_string());
    }
    Ok(())
}

/// 生成本地阅读地址。只接收 kind/bundleId，主机与端口由运行时决定；
/// `v` 为防缓存版本参数，避免 Edge 复用上一次的响应内容。
fn artifact_read_url(port: u16, kind: &str, bundle_id: &str, version: &str) -> String {
    let mut url = url::Url::parse("http://127.0.0.1/")
        .expect("literal loopback base url must parse")
        .join("/api/lab-artifacts")
        .expect("literal relative path must join");
    url.set_port(Some(port))
        .map_err(|()| "port")
        .expect("http scheme allows explicit port");
    url.query_pairs_mut()
        .append_pair("preview", "1")
        .append_pair("kind", kind)
        .append_pair("bundleId", bundle_id)
        .append_pair("v", version);
    url.to_string()
}

/// 启动 Edge 前的受限预检：必须 200、content-type 为 application/pdf、
/// 且响应体以 %PDF- 开头。只读首块，不下载整个文件。
fn preflight_pdf(url: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("无法创建预检客户端: {error}"))?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("无法连接本地文献服务: {error}"))?;
    let status = response.status();
    if status != reqwest::StatusCode::OK {
        return Err(format!("本地文献服务返回 HTTP {status}"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.starts_with("application/pdf") {
        let shown = if content_type.is_empty() {
            "(缺失)".to_string()
        } else {
            content_type.clone()
        };
        return Err(format!(
            "本地文献服务返回的不是 PDF（content-type={shown}）"
        ));
    }
    use std::io::Read;
    let mut head = [0u8; 8];
    let read = response
        .read(&mut head)
        .map_err(|error| format!("读取本地文献响应失败: {error}"))?;
    if read < 5 || &head[..5] != b"%PDF-" {
        return Err("本地文献服务返回的内容不是有效 PDF（缺少文件头）".to_string());
    }
    Ok(())
}

/// 在系统浏览器中阅读当前本地运行时保存的 PDF/SI。
/// 调用方只提供受限标识，不能注入主机、端口、路径或任意查询参数。
#[tauri::command]
fn open_artifact_in_browser(
    kind: String,
    bundle_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    validate_open_request(&kind, &bundle_id)?;
    let status = state.0.status();
    let port = status
        .port
        .ok_or_else(|| "本地服务尚未就绪，请等待服务启动后重试".to_string())?;
    // 版本参数取运行时启动序号/端口与 bundle 标识，避免与旧缓存混淆。
    let version = format!("{}-{}", port, bundle_id);
    let url = artifact_read_url(port, &kind, &bundle_id, &version);
    // 分段留痕：安装后可按日志判断失败发生在预检还是 Edge 启动。
    let _ = state.0.logger().app(&format!(
        "open_artifact_in_browser: kind={kind} bundleId={bundle_id} port={port}"
    ));
    if let Err(error) = preflight_pdf(&url) {
        let _ = state.0.logger().app(&format!(
            "open_artifact_in_browser: preflight failed: {error}"
        ));
        return Err(error);
    }
    let _ = state.0.logger().app(&format!(
        "open_artifact_in_browser: preflight ok, launching Edge"
    ));
    launch_edge(&url).map_err(|error| {
        let _ = state.0.logger().app(&format!(
            "open_artifact_in_browser: launch_edge failed: {error}"
        ));
        error
    })
}

fn launch_edge(url: &str) -> Result<(), String> {
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
        .arg(url)
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
            save_text_artifact,
            open_artifact,
            open_path,
            reveal_path,
            runtime_status,
            runtime_deps,
            pick_mcp_dir,
            app_mcp_status,
            save_app_mcp,
            remove_app_mcp,
            install_origin_bridge,
            open_in_edge,
            open_artifact_in_browser
        ])
        .run(tauri::generate_context!())
        .expect("failed to run iBM Lab Agent");
}

#[cfg(test)]
mod tests {
    use super::{artifact_read_url, preflight_pdf, validate_open_request};
    use std::io::{Read, Write};

    /// 起一个一次性 loopback HTTP 服务，返回固定响应；返回 (port, 响应生成闭包已执行)。
    fn spawn_fake_server(raw_response: &'static str) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(raw_response.as_bytes());
            let _ = stream.flush();
            // 保持短暂可读，确保客户端能收到完整响应头与首块
            std::thread::sleep(std::time::Duration::from_millis(50));
        });
        port
    }

    #[test]
    fn rejects_unsupported_kind() {
        assert!(validate_open_request("pdf", "bundle-1").is_ok());
        assert!(validate_open_request("si", "bundle-1").is_ok());
        assert!(validate_open_request("zip", "bundle-1").is_err());
        assert!(validate_open_request("", "bundle-1").is_err());
    }

    #[test]
    fn rejects_unsafe_bundle_id() {
        assert!(validate_open_request("pdf", "bundle_1-2").is_ok());
        for bad in ["", "bad id", "a/b", "a?b=c", "../etc", &"x".repeat(129)] {
            assert!(
                validate_open_request("pdf", bad).is_err(),
                "应拒绝非法 bundle id: {bad:?}"
            );
        }
    }

    #[test]
    fn read_url_is_confined_to_loopback_artifacts() {
        let url = artifact_read_url(5173, "si", "bundle-9", "5173-bundle-9");
        assert!(
            url.starts_with("http://127.0.0.1:5173/api/lab-artifacts?"),
            "{url}"
        );
        assert!(url.contains("kind=si"), "{url}");
        assert!(url.contains("bundleId=bundle-9"), "{url}");
        assert!(url.contains("v=5173-bundle-9"), "{url}");
    }

    #[test]
    fn read_url_cannot_be_injected_by_bundle_id() {
        // 即使传入伪装成分段的值，也只能落在查询串内，不能改变主机、端口或路径。
        let url = artifact_read_url(5173, "pdf", "x@evil.example", "v1");
        assert!(
            url.starts_with("http://127.0.0.1:5173/api/lab-artifacts?"),
            "{url}"
        );
        assert!(!url.contains("evil.example/"), "{url}");
    }

    #[test]
    fn preflight_accepts_real_pdf_response() {
        let port = spawn_fake_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 16\r\nConnection: close\r\n\r\n%PDF-1.7 trailer",
        );
        let url = format!("http://127.0.0.1:{port}/api/lab-artifacts?preview=1&kind=pdf");
        if let Err(error) = preflight_pdf(&url) {
            panic!("正常 PDF 响应应当通过预检: {error}");
        }
    }

    #[test]
    fn preflight_rejects_non_200() {
        let port = spawn_fake_server(
            "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nnope!",
        );
        let url = format!("http://127.0.0.1:{port}/api/lab-artifacts?preview=1&kind=pdf");
        let error = preflight_pdf(&url).expect_err("应失败");
        assert!(error.contains("404"), "错误信息应包含状态码: {error}");
    }

    #[test]
    fn preflight_rejects_non_pdf_content_type() {
        let port = spawn_fake_server(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 9\r\nConnection: close\r\n\r\nloginpage",
        );
        let url = format!("http://127.0.0.1:{port}/api/lab-artifacts?preview=1&kind=pdf");
        let error = preflight_pdf(&url).expect_err("应失败");
        assert!(
            error.contains("不是 PDF"),
            "错误信息应说明类型不符: {error}"
        );
    }

    #[test]
    fn preflight_rejects_pdf_content_type_with_non_pdf_body() {
        // 登陆页/错误页伪装成 PDF content-type 时，也必须被文件头检查拦下。
        let port = spawn_fake_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 10\r\nConnection: close\r\n\r\n<html></html>",
        );
        let url = format!("http://127.0.0.1:{port}/api/lab-artifacts?preview=1&kind=si");
        let error = preflight_pdf(&url).expect_err("应失败");
        assert!(
            error.contains("缺少文件头"),
            "错误信息应说明文件头缺失: {error}"
        );
    }

    #[test]
    fn preflight_rejects_dead_endpoint() {
        // 绑定后立即关闭，模拟本地服务未就绪/端口无监听。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        let url = format!("http://127.0.0.1:{port}/api/lab-artifacts?preview=1&kind=pdf");
        assert!(preflight_pdf(&url).is_err());
    }
}

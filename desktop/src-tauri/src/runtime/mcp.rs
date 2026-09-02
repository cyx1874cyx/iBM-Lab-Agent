use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::{AppConfig, McpServerConfig, RuntimeError};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMcpStatus {
    pub app_key: String,
    pub server_name: String,
    pub enabled: bool,
    pub configured: bool,
    pub directory: String,
    pub server_file_exists: bool,
    pub uv_available: bool,
    pub connected: bool,
    pub state: String,
    pub detail: String,
}

fn uv_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("uv")];
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(profile).join(r".local\bin\uv.exe"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join(r"Programs\uv\uv.exe"));
    }
    candidates
}

fn resolve_uv() -> Option<PathBuf> {
    uv_candidates().into_iter().find(|candidate| {
        let mut command = Command::new(candidate);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
}

fn handshake(uv: &Path, directory: &Path) -> Result<(), RuntimeError> {
    let mut command = Command::new(uv);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .args(["run", "--directory"])
        .arg(directory)
        .arg("run_server.py")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| RuntimeError::new(format!("无法启动 Mnova MCP: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| RuntimeError::new("Mnova MCP stdin 不可用"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::new("Mnova MCP stdout 不可用"))?;
    let messages = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ibm-lab-desktop","version":"0.1.16"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
    ];
    for message in messages {
        writeln!(stdin, "{message}").map_err(|error| {
            RuntimeError::new(format!("无法向 Mnova MCP 发送自检请求: {error}"))
        })?;
    }
    stdin
        .flush()
        .map_err(|error| RuntimeError::new(format!("无法提交 Mnova MCP 自检请求: {error}")))?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let is_tools_response = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|value| value.get("id").and_then(|id| id.as_i64()))
                == Some(2);
            if is_tools_response {
                let _ = sender.send(line);
                return;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err(RuntimeError::new("Mnova MCP 连接测试超时（10 秒）"));
        }
        match receiver.recv_timeout(remaining) {
            Ok(line) if line.contains(r#""error"#) => {
                break Err(RuntimeError::new(format!("Mnova MCP 返回错误: {line}")))
            }
            Ok(_) => break Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                break Err(RuntimeError::new("Mnova MCP 连接测试超时（10 秒）"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(RuntimeError::new("Mnova MCP 在完成握手前退出"))
            }
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

pub fn server_name_for(app_key: &str) -> Option<&'static str> {
    match app_key {
        "mnova" => Some("mnova"),
        _ => None,
    }
}

pub fn status(config: &AppConfig, app_key: &str, test_connection: bool) -> AppMcpStatus {
    let entry = config
        .mcp_servers
        .iter()
        .find(|entry| entry.app_key == app_key);
    let fallback = McpServerConfig {
        app_key: app_key.to_string(),
        server_name: server_name_for(app_key).unwrap_or(app_key).to_string(),
        enabled: false,
        directory: String::new(),
    };
    let entry = entry.unwrap_or(&fallback);
    let directory = PathBuf::from(entry.directory.trim());
    let configured = !entry.directory.trim().is_empty();
    let server_file_exists = configured && directory.join("run_server.py").is_file();
    let uv = resolve_uv();
    let uv_available = uv.is_some();
    let (connected, state, detail) = if !configured {
        (false, "unconfigured", "尚未配置 MCP".to_string())
    } else if !entry.enabled {
        (false, "disabled", "MCP 已配置但未启用".to_string())
    } else if !server_file_exists {
        (
            false,
            "invalid",
            "配置目录无效或缺少 run_server.py".to_string(),
        )
    } else if !uv_available {
        (
            false,
            "missing",
            "未找到 uv，无法启动 Mnova MCP".to_string(),
        )
    } else if !test_connection {
        (
            false,
            "ready",
            "配置检查通过；点击“测试连接”执行 MCP 握手".to_string(),
        )
    } else {
        match handshake(uv.as_deref().expect("uv checked"), &directory) {
            Ok(()) => (true, "connected", "MCP 握手及工具列表请求成功".to_string()),
            Err(error) => (false, "error", error.to_string()),
        }
    };
    AppMcpStatus {
        app_key: app_key.to_string(),
        server_name: entry.server_name.clone(),
        enabled: entry.enabled,
        configured,
        directory: entry.directory.clone(),
        server_file_exists,
        uv_available,
        connected,
        state: state.into(),
        detail,
    }
}

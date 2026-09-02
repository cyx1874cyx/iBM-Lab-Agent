mod bridge;
mod config;
mod deps;
mod dsh;
mod files;
mod health;
mod logging;
mod mcp;
mod port;
mod process;

use std::collections::HashSet;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub use config::{AppConfig, McpServerConfig};
pub use deps::RuntimeDeps;
use dsh::{bootstrap_user_data, RuntimeLayout};
pub use files::SavedArtifact;
use logging::AppLogger;
pub use mcp::AppMcpStatus;
use process::ManagedProcess;

#[derive(Debug)]
pub struct RuntimeError(String);

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl Display for RuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::error::Error for RuntimeError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub url: Option<String>,
    pub dsh_version: String,
    pub node_version: String,
    pub logs_dir: String,
}

pub struct RuntimeManager {
    layout: RuntimeLayout,
    logger: AppLogger,
    process: Mutex<Option<ManagedProcess>>,
    saved_paths: Mutex<HashSet<PathBuf>>,
    status: Arc<Mutex<RuntimeStatus>>,
}

impl RuntimeManager {
    pub fn new(app: AppHandle) -> Result<Self, RuntimeError> {
        let local_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("iBM-Lab-Agent"))
            .or_else(|| app.path().app_local_data_dir().ok())
            .ok_or_else(|| RuntimeError::new("Cannot resolve local application data directory"))?;
        let resource_dir = app.path().resource_dir().map_err(|error| {
            RuntimeError::new(format!("Cannot resolve bundled resources: {error}"))
        })?;
        // On Windows the packaged resource dir may come back as a verbatim
        // extended-length path (\\?\H:\...). Node.js 24 realpathSync cannot
        // parse the `\\?\` prefix and fails with EISDIR on the bare drive
        // root, so normalize it back to the regular path form.
        let resource_dir = if cfg!(windows) {
            let text = resource_dir.to_string_lossy();
            if let Some(stripped) = text.strip_prefix(r"\\?\") {
                PathBuf::from(stripped)
            } else {
                resource_dir
            }
        } else {
            resource_dir
        };
        let development_resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let resources = if resource_dir.join("node").exists() {
            resource_dir
        } else {
            development_resources
        };
        let layout = RuntimeLayout::new(local_data, resources);
        layout.create_user_directories()?;
        let logger = AppLogger::new(layout.logs_dir.clone())?;
        logger.app("Desktop shell initialized")?;
        Ok(Self {
            status: Arc::new(Mutex::new(RuntimeStatus {
                running: false,
                port: None,
                pid: None,
                url: None,
                dsh_version: "0.1.1-rc.2".to_string(),
                node_version: "24.16.0".to_string(),
                logs_dir: layout.logs_dir.display().to_string(),
            })),
            layout,
            logger,
            process: Mutex::new(None),
            saved_paths: Mutex::new(HashSet::new()),
        })
    }

    pub fn start(&self) -> Result<String, RuntimeError> {
        if let Some(url) = self.running_url() {
            return Ok(url);
        }
        self.shutdown_stale_process()?;
        bootstrap_user_data(&self.layout, &self.logger)?;
        // Native Messaging host 自动注册（P0-5）：首次启动写 manifest + wrapper
        // 并注册 Chrome/Edge HKCU，用户无需命令行操作。失败不阻断 DSH 启动，
        // 状态可在 P1-1 runtime dependency doctor 中暴露。
        if let Err(error) = bridge::ensure_registered(&self.layout, &self.logger) {
            let _ = self.logger.write(
                "error.log",
                &format!("Native Messaging host registration failed: {error}"),
            );
        }
        // 优先复用上次持久化端口：扩展/Native Messaging 注册的 trustedOrigin
        // 跟随端口，端口漂移会造成捕获回传静默失败；仅在占用时才另寻端口。
        let port = self.reconcile_port()?;
        let config = self.load_config()?;
        let child = process::spawn_dsh(&self.layout, &self.logger, port, &config)?;
        let pid = child.id();
        self.logger
            .app(&format!("Started DSH child process pid={pid}, port={port}"))?;
        process::write_pid_state(&self.layout, pid, port)?;
        *self
            .process
            .lock()
            .map_err(|_| RuntimeError::new("Runtime process lock poisoned"))? = Some(child);
        let url = match health::wait_until_ready(port, &self.process, &self.logger) {
            Ok(url) => url,
            Err(error) => {
                if let Ok(mut guard) = self.process.lock() {
                    if let Some(mut child) = guard.take() {
                        if child.try_wait().ok().flatten().is_none() {
                            let _ = process::terminate_process_tree(&mut child, &self.logger);
                        }
                    }
                }
                let _ = process::remove_pid_state(&self.layout);
                return Err(error);
            }
        };
        *self
            .status
            .lock()
            .map_err(|_| RuntimeError::new("Runtime status lock poisoned"))? = RuntimeStatus {
            running: true,
            port: Some(port),
            pid: Some(pid),
            url: Some(url.clone()),
            dsh_version: "0.1.1-rc.2".to_string(),
            node_version: "24.16.0".to_string(),
            logs_dir: self.layout.logs_dir.display().to_string(),
        };
        self.logger
            .app(&format!("DSH health check passed: {url}"))?;
        Ok(url)
    }

    /// 端口对账：上次持久化端口仍可用则复用，否则在候选范围内寻找新端口。
    fn reconcile_port(&self) -> Result<u16, RuntimeError> {
        if let Some((_, previous)) = process::read_runtime_state(&self.layout)? {
            if port::is_available(previous) {
                self.logger
                    .app(&format!("Reusing persisted runtime port {previous}"))?;
                return Ok(previous);
            }
            self.logger.app(&format!(
                "Persisted port {previous} is in use; selecting a new port"
            ))?;
        }
        let port = port::find_available_port(3080, 32)?;
        self.logger
            .app(&format!("Selected new runtime port {port}"))?;
        Ok(port)
    }

    pub fn shutdown(&self) -> Result<(), RuntimeError> {
        let mut guard = self
            .process
            .lock()
            .map_err(|_| RuntimeError::new("Runtime process lock poisoned"))?;
        if let Some(mut child) = guard.take() {
            self.logger
                .app(&format!("Stopping DSH process tree pid={}", child.id()))?;
            process::terminate_process_tree(&mut child, &self.logger)?;
        } else if let Some(pid) = process::read_pid_state(&self.layout)? {
            if process::is_our_dsh_process(pid, &self.layout) {
                self.logger.app(&format!(
                    "Stopping starting/stale DSH process tree pid={pid}"
                ))?;
                process::terminate_pid_tree(pid, &self.logger)?;
            }
        }
        process::remove_pid_state(&self.layout)?;
        let mut status = self
            .status
            .lock()
            .map_err(|_| RuntimeError::new("Runtime status lock poisoned"))?;
        status.running = false;
        status.port = None;
        status.pid = None;
        status.url = None;
        Ok(())
    }

    fn running_url(&self) -> Option<String> {
        let mut guard = self.process.lock().ok()?;
        let process = guard.as_mut()?;
        match process.try_wait() {
            Ok(None) => self.status.lock().ok()?.url.clone(),
            Ok(Some(_)) | Err(_) => {
                *guard = None;
                None
            }
        }
    }

    fn shutdown_stale_process(&self) -> Result<(), RuntimeError> {
        if let Some(pid) = process::read_pid_state(&self.layout)? {
            if process::is_our_dsh_process(pid, &self.layout) {
                self.logger.app(&format!(
                    "Found stale iBM Lab DSH PID state: {pid}; attempting cleanup"
                ))?;
                process::terminate_pid_tree(pid, &self.logger)?;
            } else {
                self.logger.app(&format!("Discarding stale PID state {pid}: it no longer identifies this application's DSH command"))?;
            }
            process::remove_pid_state(&self.layout)?;
        }
        Ok(())
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| RuntimeStatus {
                running: false,
                port: None,
                pid: None,
                url: None,
                dsh_version: "0.1.1-rc.2".to_string(),
                node_version: "24.16.0".to_string(),
                logs_dir: self.layout.logs_dir.display().to_string(),
            })
    }

    pub fn open_logs(&self) -> Result<(), RuntimeError> {
        files::open_path(&self.layout.logs_dir)
    }

    /// 供桌面命令写入 app.log；logger 为私有字段，上层模块需要经此访问。
    pub fn logger(&self) -> &AppLogger {
        &self.logger
    }

    pub fn open_workspace(&self) -> Result<(), RuntimeError> {
        let config = self.load_config()?;
        files::open_workspace(&self.layout, &config.workspace)
    }

    pub fn save_artifact(&self, url: &str) -> Result<SavedArtifact, RuntimeError> {
        let port = self
            .status
            .lock()
            .map_err(|_| RuntimeError::new("Runtime status lock poisoned"))?
            .port
            .ok_or_else(|| RuntimeError::new("Local runtime is not ready"))?;
        let saved = files::save_artifact(url, port)?;
        if let Some(path) = saved.file_path.as_deref() {
            self.saved_paths
                .lock()
                .map_err(|_| RuntimeError::new("Saved path lock poisoned"))?
                .insert(PathBuf::from(path));
        }
        Ok(saved)
    }
    pub fn save_text_artifact(
        &self,
        file_name: &str,
        text: &str,
    ) -> Result<SavedArtifact, RuntimeError> {
        let saved = files::save_text_artifact(file_name, text)?;
        if let Some(path) = saved.file_path.as_deref() {
            self.saved_paths
                .lock()
                .map_err(|_| RuntimeError::new("Saved path lock poisoned"))?
                .insert(PathBuf::from(path));
        }
        Ok(saved)
    }
    pub fn open_artifact(&self, url: &str) -> Result<(), RuntimeError> {
        let port = self
            .status
            .lock()
            .map_err(|_| RuntimeError::new("Runtime status lock poisoned"))?
            .port
            .ok_or_else(|| RuntimeError::new("Local runtime is not ready"))?;
        files::open_artifact(url, port, &self.layout.state_dir.join("open-artifacts"))
    }

    fn is_session_saved_path(&self, path: &std::path::Path) -> Result<bool, RuntimeError> {
        Ok(self
            .saved_paths
            .lock()
            .map_err(|_| RuntimeError::new("Saved path lock poisoned"))?
            .contains(path))
    }

    pub fn open_path(&self, path: &str) -> Result<(), RuntimeError> {
        let path = std::path::Path::new(path);
        if !self.is_session_saved_path(path)? {
            return Err(RuntimeError::new(
                "Only artifacts saved during this desktop session may be opened",
            ));
        }
        files::open_path(path)
    }
    pub fn reveal_path(&self, path: &str) -> Result<(), RuntimeError> {
        let path = std::path::Path::new(path);
        if !self.is_session_saved_path(path)? {
            return Err(RuntimeError::new(
                "Only artifacts saved during this desktop session may be revealed",
            ));
        }
        files::reveal_path(path)
    }

    pub fn load_config(&self) -> Result<AppConfig, RuntimeError> {
        config::load(&self.layout.config_dir)
    }
    pub fn app_mcp_status(
        &self,
        app_key: &str,
        test_connection: bool,
    ) -> Result<AppMcpStatus, RuntimeError> {
        let config = self.load_config()?;
        Ok(mcp::status(&self.layout, &config, app_key, test_connection))
    }

    /// 保存某 MCP 应用配置。启动类型由 app_key → McpAppSpec 决定，
    /// 不把 launcher 写进用户 JSON；Origin 的 directory 可以为空，
    /// Mnova 的 directory 保持必需。
    pub fn save_app_mcp(
        &self,
        app_key: &str,
        directory: &str,
        enabled: bool,
    ) -> Result<AppMcpStatus, RuntimeError> {
        let spec = mcp::spec_for(app_key)
            .ok_or_else(|| RuntimeError::new(format!("Unsupported MCP application: {app_key}")))?;
        if spec.requires_directory && directory.trim().is_empty() {
            return Err(RuntimeError::new(format!(
                "{} MCP 需要选择一个服务目录",
                spec.server_name
            )));
        }
        let mut config = self.load_config()?;
        config.mcp_servers.retain(|entry| entry.app_key != app_key);
        config.mcp_servers.push(McpServerConfig {
            app_key: app_key.to_string(),
            server_name: spec.server_name.to_string(),
            enabled,
            directory: directory.trim().to_string(),
        });
        config::save(&self.layout.config_dir, config.clone())?;
        Ok(mcp::status(&self.layout, &config, app_key, false))
    }

    pub fn remove_app_mcp(&self, app_key: &str) -> Result<(), RuntimeError> {
        if mcp::spec_for(app_key).is_none() {
            return Err(RuntimeError::new(format!(
                "Unsupported MCP application: {app_key}"
            )));
        }
        let mut config = self.load_config()?;
        config.mcp_servers.retain(|entry| entry.app_key != app_key);
        config::save(&self.layout.config_dir, config)
    }

    /// 准备 Origin Bridge App 源文件并返回输出（含 OPX 注册指引）。
    /// 仅准备文件，不自动执行 Origin mkOPX。
    pub fn install_origin_bridge(&self) -> Result<String, RuntimeError> {
        mcp::install_origin_bridge(&self.layout)
    }

    /// P1-1 runtime dependency doctor：Edge/Python/Node/Bridge/Office 一屏状态。
    pub fn deps(&self) -> RuntimeDeps {
        deps::probe(&self.layout)
    }
}

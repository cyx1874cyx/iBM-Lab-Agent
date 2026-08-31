mod config;
mod dsh;
mod health;
mod logging;
mod port;
mod process;

use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub use config::AppConfig;
use dsh::{bootstrap_user_data, RuntimeLayout};
use logging::AppLogger;
use process::ManagedProcess;

#[derive(Debug)]
pub struct RuntimeError(String);

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self { Self(message.into()) }
}

impl Display for RuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result { self.0.fmt(formatter) }
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
    status: Arc<Mutex<RuntimeStatus>>,
}

impl RuntimeManager {
    pub fn new(app: AppHandle) -> Result<Self, RuntimeError> {
        let local_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("iBM-Lab-Agent"))
            .or_else(|| app.path().app_local_data_dir().ok())
            .ok_or_else(|| RuntimeError::new("Cannot resolve local application data directory"))?;
        let resource_dir = app.path().resource_dir().map_err(|error| RuntimeError::new(format!("Cannot resolve bundled resources: {error}")))?;
        let development_resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let resources = if resource_dir.join("node").exists() { resource_dir } else { development_resources };
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
        })
    }

    pub fn start(&self) -> Result<String, RuntimeError> {
        if let Some(url) = self.running_url() { return Ok(url); }
        self.shutdown_stale_process()?;
        bootstrap_user_data(&self.layout, &self.logger)?;
        let port = port::find_available_port(3080, 32)?;
        let config = self.load_config()?;
        let mut child = process::spawn_dsh(&self.layout, &self.logger, port, &config)?;
        let pid = child.id();
        self.logger.app(&format!("Started DSH child process pid={pid}, port={port}"))?;
        let url = health::wait_until_ready(port, &mut child, &self.logger)?;
        process::write_pid_state(&self.layout, pid, port)?;
        *self.process.lock().map_err(|_| RuntimeError::new("Runtime process lock poisoned"))? = Some(child);
        *self.status.lock().map_err(|_| RuntimeError::new("Runtime status lock poisoned"))? = RuntimeStatus {
            running: true,
            port: Some(port),
            pid: Some(pid),
            url: Some(url.clone()),
            dsh_version: "0.1.1-rc.2".to_string(),
            node_version: "24.16.0".to_string(),
            logs_dir: self.layout.logs_dir.display().to_string(),
        };
        self.logger.app(&format!("DSH health check passed: {url}"))?;
        Ok(url)
    }

    pub fn shutdown(&self) -> Result<(), RuntimeError> {
        let mut guard = self.process.lock().map_err(|_| RuntimeError::new("Runtime process lock poisoned"))?;
        if let Some(mut child) = guard.take() {
            self.logger.app(&format!("Stopping DSH process tree pid={}", child.id()))?;
            process::terminate_process_tree(&mut child, &self.logger)?;
        }
        process::remove_pid_state(&self.layout)?;
        let mut status = self.status.lock().map_err(|_| RuntimeError::new("Runtime status lock poisoned"))?;
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
                self.logger.app(&format!("Found stale iBM Lab DSH PID state: {pid}; attempting cleanup"))?;
                process::terminate_pid_tree(pid, &self.logger)?;
            } else {
                self.logger.app(&format!("Discarding stale PID state {pid}: it no longer identifies this application's DSH command"))?;
            }
            process::remove_pid_state(&self.layout)?;
        }
        Ok(())
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status.lock().map(|status| status.clone()).unwrap_or_else(|_| RuntimeStatus {
            running: false, port: None, pid: None, url: None,
            dsh_version: "0.1.1-rc.2".to_string(), node_version: "24.16.0".to_string(), logs_dir: self.layout.logs_dir.display().to_string(),
        })
    }

    pub fn open_logs(&self) -> Result<(), RuntimeError> {
        std::process::Command::new("explorer.exe").arg(&self.layout.logs_dir).spawn()
            .map_err(|error| RuntimeError::new(format!("Cannot open logs directory: {error}")))?;
        Ok(())
    }

    pub fn load_config(&self) -> Result<AppConfig, RuntimeError> { config::load(&self.layout.config_dir) }
    pub fn save_config(&self, config: AppConfig) -> Result<(), RuntimeError> { config::save(&self.layout.config_dir, config) }
}

use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use super::RuntimeError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub workspace: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { api_key: String::new(), base_url: String::new(), model: String::new(), workspace: String::new() }
    }
}

pub fn load(config_dir: &Path) -> Result<AppConfig, RuntimeError> {
    let path = config_dir.join("app-config.json");
    if !path.exists() { return Ok(AppConfig::default()); }
    serde_json::from_slice(&fs::read(&path).map_err(|error| RuntimeError::new(format!("Cannot read app configuration: {error}")))?)
        .map_err(|error| RuntimeError::new(format!("Invalid app configuration: {error}")))
}

pub fn save(config_dir: &Path, config: AppConfig) -> Result<(), RuntimeError> {
    fs::create_dir_all(config_dir).map_err(|error| RuntimeError::new(format!("Cannot create config directory: {error}")))?;
    let target = config_dir.join("app-config.json");
    let body = serde_json::to_vec_pretty(&config).map_err(|error| RuntimeError::new(format!("Cannot serialize app configuration: {error}")))?;
    fs::write(target, body).map_err(|error| RuntimeError::new(format!("Cannot write app configuration: {error}")))
}

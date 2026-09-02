use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::RuntimeError;

const CREDENTIAL_REF: &str = "dpapi:user:api-key-v1";
const CREDENTIAL_FILE: &str = "api-key.dpapi";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub app_key: String,
    pub server_name: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub directory: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub workspace: String,
    #[serde(default)]
    pub mnova_mcp_enabled: bool,
    #[serde(default)]
    pub mnova_mcp_dir: String,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: String::new(),
            model: String::new(),
            workspace: String::new(),
            mnova_mcp_enabled: false,
            mnova_mcp_dir: String::new(),
            mcp_servers: Vec::new(),
        }
    }
}

/// The on-disk shape intentionally has no serializable API key. `api_key` is
/// deserialize-only to migrate older plaintext installations once.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskConfig {
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    workspace: String,
    #[serde(default)]
    mnova_mcp_enabled: bool,
    #[serde(default)]
    mnova_mcp_dir: String,
    #[serde(default)]
    mcp_servers: Vec<McpServerConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    credential_ref: Option<String>,
}

fn credential_path(config_dir: &Path) -> PathBuf {
    config_dir.join(CREDENTIAL_FILE)
}

fn write_atomic(path: &Path, body: &[u8]) -> Result<(), RuntimeError> {
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, body)
        .map_err(|error| RuntimeError::new(format!("Cannot write {}: {error}", temp.display())))?;
    replace_atomic(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

#[cfg(windows)]
fn replace_atomic(temp: &Path, target: &Path) -> Result<(), RuntimeError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        return Err(RuntimeError::new(format!(
            "Cannot atomically replace {}: {}",
            target.display(),
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_atomic(temp: &Path, target: &Path) -> Result<(), RuntimeError> {
    fs::rename(temp, target).map_err(|error| {
        RuntimeError::new(format!("Cannot finalize {}: {error}", target.display()))
    })
}

#[cfg(windows)]
fn protect_secret(secret: &[u8]) -> Result<Vec<u8>, RuntimeError> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: secret
            .len()
            .try_into()
            .map_err(|_| RuntimeError::new("API key is too large"))?,
        pbData: secret.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(RuntimeError::new(format!(
            "Windows DPAPI could not protect the API key: {}",
            std::io::Error::last_os_error()
        )));
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(protected)
}

#[cfg(windows)]
fn unprotect_secret(protected: &[u8]) -> Result<Vec<u8>, RuntimeError> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: protected
            .len()
            .try_into()
            .map_err(|_| RuntimeError::new("Protected API key is too large"))?,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(RuntimeError::new(format!(
            "Windows DPAPI could not unlock the API key for this user: {}",
            std::io::Error::last_os_error()
        )));
    }
    let secret =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(secret)
}

#[cfg(not(windows))]
fn protect_secret(_: &[u8]) -> Result<Vec<u8>, RuntimeError> {
    Err(RuntimeError::new(
        "DPAPI credential storage is available only on Windows",
    ))
}
#[cfg(not(windows))]
fn unprotect_secret(_: &[u8]) -> Result<Vec<u8>, RuntimeError> {
    Err(RuntimeError::new(
        "DPAPI credential storage is available only on Windows",
    ))
}

pub fn load(config_dir: &Path) -> Result<AppConfig, RuntimeError> {
    let path = config_dir.join("app-config.json");
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let disk: DiskConfig =
        serde_json::from_slice(&fs::read(&path).map_err(|error| {
            RuntimeError::new(format!("Cannot read app configuration: {error}"))
        })?)
        .map_err(|error| RuntimeError::new(format!("Invalid app configuration: {error}")))?;
    let mut api_key = String::new();
    if let Some(reference) = disk.credential_ref.as_deref() {
        if reference != CREDENTIAL_REF {
            return Err(RuntimeError::new(
                "Unsupported API key credential reference",
            ));
        }
        let protected = fs::read(credential_path(config_dir)).map_err(|error| {
            RuntimeError::new(format!("Cannot read protected API key: {error}"))
        })?;
        api_key = String::from_utf8(unprotect_secret(&protected)?)
            .map_err(|_| RuntimeError::new("Protected API key is not valid UTF-8"))?;
    } else if let Some(legacy) = disk
        .api_key
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        api_key = legacy.clone();
        save(
            config_dir,
            AppConfig {
                api_key: api_key.clone(),
                base_url: disk.base_url.clone(),
                model: disk.model.clone(),
                workspace: disk.workspace.clone(),
                mnova_mcp_enabled: disk.mnova_mcp_enabled,
                mnova_mcp_dir: disk.mnova_mcp_dir.clone(),
                mcp_servers: disk.mcp_servers.clone(),
            },
        )?;
    }
    let mut mcp_servers = disk.mcp_servers;
    // 旧 Mnova 单字段（mnova_mcp_enabled / mnova_mcp_dir）迁移：只要目录非空，
    // 就补一条 mnova 条目，避免 mcp_servers 已存在其他应用时旧配置丢失。
    if !mcp_servers.iter().any(|entry| entry.app_key == "mnova")
        && !disk.mnova_mcp_dir.trim().is_empty()
    {
        mcp_servers.push(McpServerConfig {
            app_key: "mnova".into(),
            server_name: "mnova".into(),
            enabled: disk.mnova_mcp_enabled,
            directory: disk.mnova_mcp_dir.clone(),
        });
    }
    Ok(AppConfig {
        api_key,
        base_url: disk.base_url,
        model: disk.model,
        workspace: disk.workspace,
        mnova_mcp_enabled: disk.mnova_mcp_enabled,
        mnova_mcp_dir: disk.mnova_mcp_dir,
        mcp_servers,
    })
}

pub fn save(config_dir: &Path, config: AppConfig) -> Result<(), RuntimeError> {
    fs::create_dir_all(config_dir)
        .map_err(|error| RuntimeError::new(format!("Cannot create config directory: {error}")))?;
    // 旧 Mnova 单字段镜像：始终以 mcp_servers 中的 mnova 条目为准（迁移逻辑
    // 收敛在 config.rs；上层 save_app_mcp/remove_app_mcp 不再关心旧字段）。
    let (mnova_enabled, mnova_dir) = config
        .mcp_servers
        .iter()
        .find(|entry| entry.app_key == "mnova")
        .map(|entry| (entry.enabled, entry.directory.clone()))
        .unwrap_or((false, String::new()));
    let secret_path = credential_path(config_dir);
    let credential_ref = if config.api_key.trim().is_empty() {
        if secret_path.exists() {
            fs::remove_file(&secret_path).map_err(|error| {
                RuntimeError::new(format!("Cannot remove protected API key: {error}"))
            })?;
        }
        None
    } else {
        write_atomic(
            &secret_path,
            &protect_secret(config.api_key.trim().as_bytes())?,
        )?;
        Some(CREDENTIAL_REF.to_string())
    };
    let disk = DiskConfig {
        api_key: None,
        base_url: config.base_url,
        model: config.model,
        workspace: config.workspace,
        mnova_mcp_enabled: mnova_enabled,
        mnova_mcp_dir: mnova_dir,
        mcp_servers: config.mcp_servers,
        credential_ref,
    };
    let body = serde_json::to_vec_pretty(&disk).map_err(|error| {
        RuntimeError::new(format!("Cannot serialize app configuration: {error}"))
    })?;
    write_atomic(&config_dir.join("app-config.json"), &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ibm-config-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip_keeps_secret_out_of_json() {
        let dir = sandbox("roundtrip");
        save(
            &dir,
            AppConfig {
                api_key: "secret-test-key".into(),
                base_url: "https://example.test".into(),
                model: "m".into(),
                workspace: "w".into(),
                mnova_mcp_enabled: true,
                mnova_mcp_dir: r"C:\tools\mnova-mcp".into(),
                mcp_servers: Vec::new(),
            },
        )
        .unwrap();
        let json = fs::read_to_string(dir.join("app-config.json")).unwrap();
        assert!(!json.contains("secret-test-key"));
        assert!(!json.contains("apiKey"));
        assert!(json.contains(CREDENTIAL_REF));
        assert_eq!(load(&dir).unwrap().api_key, "secret-test-key");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn migrates_legacy_plaintext_config_on_read() {
        let dir = sandbox("migration");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("app-config.json"),
            r#"{"apiKey":"legacy-secret","baseUrl":"","model":"","workspace":""}"#,
        )
        .unwrap();
        assert_eq!(load(&dir).unwrap().api_key, "legacy-secret");
        let json = fs::read_to_string(dir.join("app-config.json")).unwrap();
        assert!(!json.contains("legacy-secret"));
        assert!(!json.contains("apiKey"));
        let _ = fs::remove_dir_all(dir);
    }
}

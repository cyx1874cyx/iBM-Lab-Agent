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
    /// Origin 工具面档位（ORIGIN_MCP_TOOL_PROFILE）。None=默认 compact。
    /// 在 MCP server 启动时读取一次，修改后需重启运行环境生效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_profile: Option<String>,
}

/// WebVPN 配置。
///
/// **不得存放任何凭据、Cookie、Local Storage 内容或 SSO ticket**：登录态完全由
/// WebView2 的专属 profile 目录承载，这里只存非敏感的导航策略。
pub const DEFAULT_WEBVPN_PORTAL: &str = "https://wvpn.ustc.edu.cn/";

/// USTC 统一身份认证链路上实测出现的额外放行域名（门户自身由 `portal_url` 推导）。
///
/// 2026-09-11 用浏览器 UA 跟完整跳转链实测：
/// `wvpn.ustc.edu.cn/` →302 `/login` →302 **`passport.ustc.edu.cn/login?service=…`**
/// →302 `id.ustc.edu.cn/cas/login` →200。
///
/// 少了 `passport.ustc.edu.cn` 时，第一跳（服务器端 302）就会被导航白名单拦掉，
/// 用户看到的正是「一片白、看不见东西」。该域名在 `src/literature/data-sources.js`
/// 的 `loginHosts` 里早已被认定为 USTC SSO 域名，这里补齐。
pub const USTC_SSO_HOSTS: &[&str] = &["id.ustc.edu.cn", "passport.ustc.edu.cn"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebVpnConfig {
    /// 学校 WebVPN 门户地址。该地址已在真实 USTC 会话中完成阶段 0 验证。
    #[serde(default)]
    pub portal_url: String,
    /// 额外放行的域名（统一认证、二次验证、WebVPN 代理域名、出版社）。
    /// 门户自身的 host 由 `portal_url` 推导，无需在此重复。
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// 是否启用导航白名单拦截。
    ///
    /// 阶段 0 探测期必须为 `false`：白名单正是要测得的东西，提前拦截会把学校
    /// SSO 登录流程自己锁死，且用户无法自救。白名单由实测结果填充后再翻转。
    #[serde(default)]
    pub enforce_navigation: bool,
}

impl Default for WebVpnConfig {
    fn default() -> Self {
        Self {
            portal_url: DEFAULT_WEBVPN_PORTAL.to_string(),
            allowed_hosts: USTC_SSO_HOSTS.iter().map(|host| host.to_string()).collect(),
            enforce_navigation: true,
        }
    }
}

/// 门户是否属于学校自有域。只有学校门户才需要、也才允许自动补齐 USTC 的认证域名。
fn is_ustc_portal(portal_url: &str) -> bool {
    url::Url::parse(portal_url.trim())
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
        .map(|host| host == "ustc.edu.cn" || host.ends_with(".ustc.edu.cn"))
        .unwrap_or(false)
}

/// 学校门户下保证统一认证链路上的域名都在白名单里。
///
/// 只对 USTC 门户生效：其它学校的门户不该被塞进 USTC 域名；指向自定义门户、
/// 自定义域名集合的配置（例如 `webvpn.example.edu` + `idp.example.edu`）保持原样。
///
/// 之所以要在**读取时**补齐而不是只改默认值：升级前已经落盘过旧默认白名单
/// （只含 `id.ustc.edu.cn`）的安装，光改 `Default` 是救不回来的——它会一直卡在
/// 被拦成白页的状态，且 release 构建下用户看不到任何诊断。
fn ensure_ustc_sso_hosts(config: &mut WebVpnConfig) {
    if !is_ustc_portal(&config.portal_url) {
        return;
    }
    for host in USTC_SSO_HOSTS {
        if !config.allowed_hosts.iter().any(|existing| existing == host) {
            config.allowed_hosts.push((*host).to_string());
        }
    }
    config.allowed_hosts.sort();
    config.allowed_hosts.dedup();
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
    #[serde(default)]
    pub webvpn: WebVpnConfig,
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
            webvpn: WebVpnConfig::default(),
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
    #[serde(default)]
    webvpn: WebVpnConfig,
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
                webvpn: disk.webvpn.clone(),
            },
        )?;
    }
    let mut mcp_servers = disk.mcp_servers;
    // 旧 Mnova 单字段（mnova_mcp_enabled / mnova_mcp_dir）迁移：只要曾经
    // enabled 或目录非空，就补一条 mnova 条目，避免 mcp_servers 已存在其他
    // 应用时旧配置丢失。0.2.0 起 directory 不再参与启动（BundledPythonModule），
    // 因此旧配置 dir 为空但 enabled 的 broken 态也一并迁移（保持启用意图）。
    if !mcp_servers.iter().any(|entry| entry.app_key == "mnova")
        && (disk.mnova_mcp_enabled || !disk.mnova_mcp_dir.trim().is_empty())
    {
        mcp_servers.push(McpServerConfig {
            app_key: "mnova".into(),
            server_name: "mnova".into(),
            enabled: disk.mnova_mcp_enabled,
            directory: disk.mnova_mcp_dir.clone(),
            tool_profile: None,
        });
    }
    let mut webvpn = if disk.webvpn.portal_url.trim().is_empty() {
        // 阶段 0 前的开发构建曾把空配置写入磁盘。现在门户已经实测确认，
        // 将这类旧值迁移到安全默认值，避免升级后仍提示“尚未配置”。
        WebVpnConfig::default()
    } else {
        disk.webvpn
    };
    // 旧默认白名单只含 id.ustc.edu.cn，缺 passport.ustc.edu.cn 会在首跳被拦成白页。
    ensure_ustc_sso_hosts(&mut webvpn);
    Ok(AppConfig {
        api_key,
        base_url: disk.base_url,
        model: disk.model,
        workspace: disk.workspace,
        mnova_mcp_enabled: disk.mnova_mcp_enabled,
        mnova_mcp_dir: disk.mnova_mcp_dir,
        mcp_servers,
        webvpn,
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
        webvpn: config.webvpn,
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
                webvpn: WebVpnConfig::default(),
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

    fn write_disk_config(dir: &Path, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("app-config.json"), body).unwrap();
    }

    #[test]
    fn migrates_legacy_mnova_fields_with_dir() {
        let dir = sandbox("mnova-dir");
        write_disk_config(
            &dir,
            r#"{"mnovaMcpEnabled":true,"mnovaMcpDir":"C:\\tools\\mnova-mcp"}"#,
        );
        let config = load(&dir).unwrap();
        let mnova = config
            .mcp_servers
            .iter()
            .find(|entry| entry.app_key == "mnova")
            .expect("mnova entry must be migrated");
        assert!(mnova.enabled);
        assert_eq!(mnova.directory, r"C:\tools\mnova-mcp");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migrates_legacy_mnova_enabled_without_dir() {
        // 旧版本 enabled=true 但目录为空（broken 态）：0.2.0 下目录不再参与
        // 启动，迁移须保留用户启用意图。
        let dir = sandbox("mnova-enable-only");
        write_disk_config(&dir, r#"{"mnovaMcpEnabled":true,"mnovaMcpDir":""}"#);
        let config = load(&dir).unwrap();
        let mnova = config
            .mcp_servers
            .iter()
            .find(|entry| entry.app_key == "mnova")
            .expect("enabled legacy mnova must migrate even with empty dir");
        assert!(mnova.enabled);
        assert_eq!(mnova.directory, "");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn does_not_duplicate_existing_mnova_entry() {
        let dir = sandbox("mnova-existing");
        write_disk_config(
            &dir,
            r#"{"mnovaMcpEnabled":false,"mnovaMcpDir":"","mcpServers":[{"appKey":"origin","serverName":"origin","enabled":true,"directory":""}]}"#,
        );
        let config = load(&dir).unwrap();
        assert_eq!(
            config
                .mcp_servers
                .iter()
                .filter(|entry| entry.app_key == "mnova")
                .count(),
            0,
            "legacy mnova fields are empty; no entry should be fabricated"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_mirrors_mnova_entry_back_to_legacy_fields() {
        let dir = sandbox("mnova-mirror");
        save(
            &dir,
            AppConfig {
                api_key: String::new(),
                base_url: String::new(),
                model: String::new(),
                workspace: String::new(),
                mnova_mcp_enabled: false,
                mnova_mcp_dir: String::new(),
                mcp_servers: vec![McpServerConfig {
                    app_key: "mnova".into(),
                    server_name: "mnova".into(),
                    enabled: true,
                    directory: r"C:\tools\mnova-mcp".into(),
                    tool_profile: None,
                }],
                webvpn: WebVpnConfig::default(),
            },
        )
        .unwrap();
        let json = fs::read_to_string(dir.join("app-config.json")).unwrap();
        assert!(json.contains(r#""mnovaMcpEnabled": true"#), "{json}");
        assert!(json.contains(r#"C:\\tools\\mnova-mcp"#), "{json}");
        // 回读：load 不再重复加条目（已有 mnova 且磁盘字段镜像一致）
        let config = load(&dir).unwrap();
        assert_eq!(
            config
                .mcp_servers
                .iter()
                .filter(|entry| entry.app_key == "mnova")
                .count(),
            1
        );
        assert!(config.mcp_servers[0].enabled);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn webvpn_config_uses_safe_ustc_defaults_when_absent() {
        // 默认配置固定到已经实测验证的 USTC 门户与统一认证域名。
        let dir = sandbox("webvpn-default");
        save(&dir, AppConfig::default()).unwrap();
        let json = fs::read_to_string(dir.join("app-config.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed.get("webvpn"),
            Some(&serde_json::json!({
                "portalUrl": "https://wvpn.ustc.edu.cn/",
                "allowedHosts": ["id.ustc.edu.cn", "passport.ustc.edu.cn"],
                "enforceNavigation": true
            })),
            "默认 WebVPN 段落形状应稳定，便于前端读取：{json}"
        );
        let webvpn = load(&dir).unwrap().webvpn;
        assert_eq!(webvpn.portal_url, DEFAULT_WEBVPN_PORTAL);
        assert_eq!(
            webvpn.allowed_hosts,
            vec!["id.ustc.edu.cn".to_string(), "passport.ustc.edu.cn".to_string()]
        );
        assert!(webvpn.enforce_navigation);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ustc_portal_backfills_the_measured_sso_hosts() {
        // 2026-09-11 实测缺陷：门户 302 到 passport.ustc.edu.cn，旧默认白名单没有它，
        // 首跳就被导航策略拦掉，用户只看到一片白。已落盘的旧配置必须在读取时被补齐。
        let dir = sandbox("webvpn-ustc-backfill");
        write_disk_config(
            &dir,
            r#"{"baseUrl":"","model":"","workspace":"","mnovaMcpEnabled":false,"mnovaMcpDir":"","mcpServers":[],"webvpn":{"portalUrl":"https://wvpn.ustc.edu.cn/","allowedHosts":["id.ustc.edu.cn"],"enforceNavigation":true}}"#,
        );
        let webvpn = load(&dir).unwrap().webvpn;
        assert!(
            webvpn.allowed_hosts.iter().any(|host| host == "passport.ustc.edu.cn"),
            "USTC 门户必须补齐 passport.ustc.edu.cn，实际：{:?}",
            webvpn.allowed_hosts
        );
        assert!(webvpn.allowed_hosts.iter().any(|host| host == "id.ustc.edu.cn"));

        // 非 USTC 门户：自定义域名集合必须原样保留，不得被塞进 USTC 域名。
        write_disk_config(
            &dir,
            r#"{"baseUrl":"","model":"","workspace":"","mnovaMcpEnabled":false,"mnovaMcpDir":"","mcpServers":[],"webvpn":{"portalUrl":"https://webvpn.example.edu/","allowedHosts":["idp.example.edu"],"enforceNavigation":true}}"#,
        );
        let other = load(&dir).unwrap().webvpn;
        assert_eq!(
            other.allowed_hosts,
            vec!["idp.example.edu".to_string()],
            "自定义门户的白名单不得被改写"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn webvpn_config_roundtrips_and_accepts_configs_that_predate_it() {
        let dir = sandbox("webvpn-roundtrip");
        // 旧版本配置（完全没有 webvpn 字段）必须能读，不报错。
        write_disk_config(
            &dir,
            r#"{"baseUrl":"","model":"","workspace":"","mnovaMcpEnabled":false,"mnovaMcpDir":"","mcpServers":[]}"#,
        );
        let legacy = load(&dir).unwrap().webvpn;
        assert_eq!(
            legacy.portal_url, DEFAULT_WEBVPN_PORTAL,
            "缺失字段应落回默认值"
        );
        assert!(legacy.enforce_navigation);

        // 写入后回读必须逐字段一致。
        save(
            &dir,
            AppConfig {
                webvpn: WebVpnConfig {
                    portal_url: "https://webvpn.example.edu/".into(),
                    allowed_hosts: vec!["idp.example.edu".into(), "doi.org".into()],
                    enforce_navigation: true,
                },
                ..AppConfig::default()
            },
        )
        .unwrap();
        let restored = load(&dir).unwrap().webvpn;
        assert_eq!(restored.portal_url, "https://webvpn.example.edu/");
        assert_eq!(
            restored.allowed_hosts,
            vec!["idp.example.edu".to_string(), "doi.org".to_string()]
        );
        assert!(restored.enforce_navigation);

        // 配置里不允许出现凭据类字段名——WebVPN 登录态只能由 WebView2 profile 承载。
        let json = fs::read_to_string(dir.join("app-config.json")).unwrap();
        for forbidden in ["cookie", "Cookie", "password", "ticket", "credential"] {
            assert!(
                !json.contains(forbidden),
                "WebVPN 配置不得包含 {forbidden}：{json}"
            );
        }
        let _ = fs::remove_dir_all(dir);
    }
}

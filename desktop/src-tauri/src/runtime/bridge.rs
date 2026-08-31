//! Native Messaging host 自动注册（P0-5 产品化）。
//!
//! 桌面客户端启动时把桥接 host（捆绑 node.exe 运行 host.js）注册到
//! Chrome/Edge 的 NativeMessagingHosts，用户无需再在命令行运行
//! install-bridge.py；同时消除对系统 Python 的依赖（host.js 零依赖，
//! 用捆绑 node.exe 直接执行）。
//!
//! 注册是幂等的：生成的 manifest / wrapper 内容一致且注册表四键
//! （Chrome/Edge × 32/64 位）已指向有效 manifest 时跳过，避免每次
//! 启动重复写注册表。注册失败不阻断 DSH 启动（见 runtime::start），
//! 状态可经 [status] 查询供 P1-1 runtime dependency doctor 使用。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE};
use winreg::RegKey;

use super::{dsh::RuntimeLayout, logging::AppLogger, RuntimeError};

pub const HOST_NAME: &str = "com.ibm.lab.capture";

/// 默认扩展 id：P0-6 发布 Edge Add-ons 后固定；发布前与用户本机
/// 「加载已解压的扩展程序」生成的 id 一致。可用环境变量
/// IBM_LAB_EXTENSION_ID 覆盖（多开发机/CI 场景）。
pub const DEFAULT_EXTENSION_ID: &str = "lnchddahblkaaphicaglckkpedmpbfkc";

const HOST_SUBKEYS: [(&str, &str); 2] = [
    ("Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
];
const REGISTRY_VIEWS: [u32; 2] = [KEY_WOW64_32KEY, KEY_WOW64_64KEY];

/// 生成物路径：manifest 与 wrapper 落在 state_dir/bridge 下，随用户
/// 数据走（%LOCALAPPDATA%\iBM-Lab-Agent\runtime-state\bridge）。
pub struct BridgePaths {
    pub bridge_dir: PathBuf,
    pub manifest: PathBuf,
    pub wrapper: PathBuf,
}

pub fn bridge_paths(layout: &RuntimeLayout) -> BridgePaths {
    let bridge_dir = layout.state_dir.join("bridge");
    BridgePaths {
        bridge_dir: bridge_dir.clone(),
        manifest: bridge_dir.join(format!("{HOST_NAME}.json")),
        wrapper: bridge_dir.join("bridge.cmd"),
    }
}

/// 解析扩展 id：环境变量覆盖优先，否则回退默认常量。
pub fn extension_id() -> String {
    std::env::var("IBM_LAB_EXTENSION_ID")
        .map(|value| value.trim().to_lowercase())
        .ok()
        .filter(|value| valid_extension_id(value))
        .or_else(|| {
            option_env!("IBM_LAB_EXTENSION_ID")
                .map(str::to_lowercase)
                .filter(|value| valid_extension_id(value))
        })
        .unwrap_or_else(|| DEFAULT_EXTENSION_ID.to_string())
}

pub fn valid_extension_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|ch| "abcdefghijklmnop".contains(ch))
}

fn build_manifest(wrapper: &Path, extension_id: &str) -> String {
    let manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "iBM Lab 本地桥接：捕获文献文件，并安全保存已审核的 PPTX/DOCX",
        "path": wrapper.display().to_string(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")]
    });
    let mut text = serde_json::to_string_pretty(&manifest).expect("serialize native host manifest");
    text.push('\n');
    text
}

fn build_wrapper(node_exe: &Path, host_js: &Path) -> String {
    format!(
        "@echo off\r\n\
         rem iBM Lab 文献捕获 - Native Messaging host 包装器（桌面客户端自动生成）。\r\n\
         rem 绑定捆绑的 node.exe 运行 host.js，不依赖系统 Python。\r\n\
         \"{node}\" \"{host}\"\r\n\
         exit /b %errorlevel%\r\n",
        node = node_exe.display(),
        host = host_js.display()
    )
}

/// 幂等注册。返回 true 表示本次实际写入，false 表示已注册且无需变更。
pub fn ensure_registered(layout: &RuntimeLayout, logger: &AppLogger) -> Result<bool, RuntimeError> {
    let paths = bridge_paths(layout);
    let id = extension_id();
    let manifest = build_manifest(&paths.wrapper, &id);
    let wrapper = build_wrapper(
        &layout.node_exe(),
        &layout.resources.join("bridge").join("host.js"),
    );

    if is_current(&paths, &manifest, &wrapper) {
        logger.app(&format!(
            "Native Messaging host {HOST_NAME} already registered (extension {id})"
        ))?;
        return Ok(false);
    }

    fs::create_dir_all(&paths.bridge_dir).map_err(|error| {
        RuntimeError::new(format!(
            "Cannot create bridge directory {}: {error}",
            paths.bridge_dir.display()
        ))
    })?;
    fs::write(&paths.manifest, &manifest).map_err(|error| {
        RuntimeError::new(format!(
            "Cannot write host manifest {}: {error}",
            paths.manifest.display()
        ))
    })?;
    fs::write(&paths.wrapper, &wrapper).map_err(|error| {
        RuntimeError::new(format!(
            "Cannot write bridge wrapper {}: {error}",
            paths.wrapper.display()
        ))
    })?;
    for (browser, subkey) in HOST_SUBKEYS {
        register_host(subkey, &paths.manifest)
            .map_err(|error| RuntimeError::new(format!("{browser}: {error}")))?;
    }
    logger.app(&format!(
        "Registered Native Messaging host {HOST_NAME} for extension {id}"
    ))?;
    Ok(true)
}

fn is_current(paths: &BridgePaths, manifest: &str, wrapper: &str) -> bool {
    fs::read_to_string(&paths.manifest).is_ok_and(|current| current == manifest)
        && fs::read_to_string(&paths.wrapper).is_ok_and(|current| current == wrapper)
        && registry_points_to(&paths.manifest)
}

fn register_host(subkey: &str, manifest_path: &Path) -> Result<(), RuntimeError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = format!(r"{subkey}\{HOST_NAME}");
    for view in REGISTRY_VIEWS {
        let (key, _) = hkcu
            .create_subkey_with_flags(&key_path, KEY_WRITE | view)
            .map_err(|error| {
                RuntimeError::new(format!(
                    "Cannot create registry key {key_path} ({view}): {error}"
                ))
            })?;
        key.set_value("", &manifest_path.display().to_string())
            .map_err(|error| {
                RuntimeError::new(format!(
                    "Cannot set host manifest path under {key_path}: {error}"
                ))
            })?;
    }
    Ok(())
}

fn registry_value(subkey: &str, view: u32) -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = format!(r"{subkey}\{HOST_NAME}");
    let handle = hkcu
        .open_subkey_with_flags(key_path, KEY_READ | view)
        .ok()?;
    handle.get_value::<String, _>("").ok()
}

fn registry_points_to(manifest_path: &Path) -> bool {
    HOST_SUBKEYS.iter().all(|(_, subkey)| {
        REGISTRY_VIEWS.iter().all(|view| {
            registry_value(subkey, *view)
                .map(|value| Path::new(&value) == manifest_path)
                .unwrap_or(false)
        })
    })
}

/// 注册状态快照（供 P1-1 runtime dependency doctor 展示/校验）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub registered: bool,
    pub extension_id: String,
    pub manifest_path: Option<String>,
    pub wrapper_path: Option<String>,
    pub host_js_exists: bool,
    pub node_exe_exists: bool,
    pub origins_match: bool,
}

pub fn status(layout: &RuntimeLayout) -> BridgeStatus {
    let paths = bridge_paths(layout);
    let id = extension_id();
    let manifest_text = fs::read_to_string(&paths.manifest).ok();
    let origins_match = manifest_text
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|value| value.get("allowed_origins").cloned())
        .and_then(|value| value.as_array().cloned())
        .map(|origins| {
            origins
                .iter()
                .any(|origin| origin.as_str() == Some(&format!("chrome-extension://{id}/")))
        })
        .unwrap_or(false);
    BridgeStatus {
        registered: registry_points_to(&paths.manifest),
        extension_id: id,
        manifest_path: manifest_text.map(|_| paths.manifest.display().to_string()),
        wrapper_path: fs::read_to_string(&paths.wrapper)
            .ok()
            .map(|_| paths.wrapper.display().to_string()),
        host_js_exists: layout.resources.join("bridge").join("host.js").exists(),
        node_exe_exists: layout.node_exe().exists(),
        origins_match,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox_layout() -> (RuntimeLayout, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sandbox =
            std::env::temp_dir().join(format!("ibm-bridge-{}-{nonce}", std::process::id()));
        let resources = sandbox.join("resources");
        fs::create_dir_all(resources.join("node")).unwrap();
        fs::create_dir_all(resources.join("bridge")).unwrap();
        fs::write(resources.join("node").join("node.exe"), "node").unwrap();
        fs::write(resources.join("bridge").join("host.js"), "host").unwrap();
        let layout = RuntimeLayout::new(sandbox.join("data"), resources);
        layout.create_user_directories().unwrap();
        (layout, sandbox)
    }

    #[test]
    fn accepts_only_32_character_a_to_p_ids() {
        let (_, sandbox) = sandbox_layout();
        assert!(valid_extension_id("lnchddahblkaaphicaglckkpedmpbfkc"));
        assert!(!valid_extension_id("abc"));
        assert!(!valid_extension_id("lnchddahblkaaphicaglckkpedmpbfkz")); // 非法字符 z
        assert!(!valid_extension_id("LNCHDDAHBLKAAPHICAGLCKKPEDMPBFKC")); // 大写
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn builds_manifest_with_wrapper_path_and_origin() {
        let (layout, sandbox) = sandbox_layout();
        let paths = bridge_paths(&layout);
        let manifest = build_manifest(&paths.wrapper, "lnchddahblkaaphicaglckkpedmpbfkc");
        let parsed: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(parsed["name"], "com.ibm.lab.capture");
        assert_eq!(parsed["type"], "stdio");
        assert_eq!(parsed["path"], paths.wrapper.display().to_string());
        assert_eq!(
            parsed["allowed_origins"][0],
            "chrome-extension://lnchddahblkaaphicaglckkpedmpbfkc/"
        );
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn builds_wrapper_binding_bundled_node() {
        let (layout, sandbox) = sandbox_layout();
        let wrapper = build_wrapper(
            &layout.node_exe(),
            &layout.resources.join("bridge").join("host.js"),
        );
        assert!(wrapper.contains(&layout.node_exe().display().to_string()));
        assert!(wrapper.contains(r"bridge\host.js"));
        assert!(wrapper.starts_with("@echo off"));
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn is_current_detects_stale_files_and_missing_registry() {
        let (layout, sandbox) = sandbox_layout();
        let paths = bridge_paths(&layout);
        let id = extension_id();
        let manifest = build_manifest(&paths.wrapper, &id);
        let wrapper = build_wrapper(
            &layout.node_exe(),
            &layout.resources.join("bridge").join("host.js"),
        );
        // 文件尚未生成 → 不满足
        assert!(!is_current(&paths, &manifest, &wrapper));
        // 文件已生成但注册表未写 → 仍不满足（避免跳过注册）
        fs::create_dir_all(&paths.bridge_dir).unwrap();
        fs::write(&paths.manifest, &manifest).unwrap();
        fs::write(&paths.wrapper, &wrapper).unwrap();
        assert!(!is_current(&paths, &manifest, &wrapper));
        // 内容漂移（wrapper 改动）→ 不满足
        fs::write(&paths.wrapper, "stale").unwrap();
        assert!(!is_current(&paths, &manifest, &wrapper));
        // 恢复一致（未写注册表时仍 false，说明注册表是必要条件）
        fs::write(&paths.wrapper, &wrapper).unwrap();
        assert!(!is_current(&paths, &manifest, &wrapper));
        let _ = fs::remove_dir_all(sandbox);
    }

    #[test]
    fn status_reports_unregistered_when_files_missing() {
        let (layout, sandbox) = sandbox_layout();
        let snapshot = status(&layout);
        assert!(!snapshot.registered);
        assert!(snapshot.host_js_exists);
        assert!(snapshot.extension_id == DEFAULT_EXTENSION_ID);
        let _ = fs::remove_dir_all(sandbox);
    }

    /// 真实注册验证（手动运行：cargo test real_registration -- --ignored）：
    /// 在 %LOCALAPPDATA% 沙箱目录执行完整注册，检查 manifest/wrapper 生成、
    /// HKCU 四键指向、幂等第二次跳过，最后清理注册表与文件。
    #[test]
    #[ignore = "writes the real HKCU registry; run manually on Windows"]
    fn real_registration_roundtrip() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sandbox =
            std::env::temp_dir().join(format!("ibm-bridge-real-{}-{nonce}", std::process::id()));
        let resources = sandbox.join("resources");
        fs::create_dir_all(resources.join("node")).unwrap();
        fs::create_dir_all(resources.join("bridge")).unwrap();
        fs::write(resources.join("node").join("node.exe"), "node").unwrap();
        fs::write(resources.join("bridge").join("host.js"), "host").unwrap();
        let layout = RuntimeLayout::new(sandbox.join("data"), resources);
        layout.create_user_directories().unwrap();
        let logger = AppLogger::new(layout.logs_dir.clone()).unwrap();

        let paths = bridge_paths(&layout);
        let manifest_path = paths.manifest.display().to_string();

        // 1) 首次注册：实际写入
        assert!(ensure_registered(&layout, &logger).unwrap());
        // manifest 的 path 指向 wrapper（bridge.cmd），wrapper 绑定捆绑 node.exe
        let manifest_value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&paths.manifest).unwrap()).unwrap();
        assert_eq!(
            manifest_value["path"],
            serde_json::Value::String(paths.wrapper.display().to_string())
        );
        assert!(fs::read_to_string(&paths.wrapper)
            .unwrap()
            .contains("node.exe"));
        // HKCU 四键均指向本沙箱 manifest
        for (_, subkey) in HOST_SUBKEYS {
            for view in REGISTRY_VIEWS {
                assert_eq!(
                    registry_value(subkey, view).as_deref(),
                    Some(manifest_path.as_str()),
                    "{subkey} {view}"
                );
            }
        }

        // 2) 幂等：第二次不重复写入
        assert!(!ensure_registered(&layout, &logger).unwrap());

        // 3) status 反映已注册
        let snapshot = status(&layout);
        assert!(snapshot.registered);
        assert!(snapshot.origins_match);

        // 4) 清理：删除注册键与临时目录
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for (_, subkey) in HOST_SUBKEYS {
            for view in REGISTRY_VIEWS {
                if let Ok(parent) = hkcu.open_subkey_with_flags(subkey, KEY_READ | KEY_WRITE | view)
                {
                    let _ = parent.delete_subkey_all(HOST_NAME);
                }
            }
        }
        let _ = fs::remove_dir_all(&sandbox);
    }
}

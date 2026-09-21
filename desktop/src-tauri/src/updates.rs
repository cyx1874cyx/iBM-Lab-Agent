use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const RELEASE_API: &str =
    "https://git.ustc.edu.cn/api/v4/projects/qbdeng2025%2FiBM-Lab-Agent/releases/permalink/latest";
const RELEASE_BASE: &str = "https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/releases/";
const MAX_INSTALLER_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct GitLabRelease {
    name: String,
    tag_name: String,
    description: Option<String>,
    assets: GitLabAssets,
}

#[derive(Debug, Deserialize)]
struct GitLabAssets {
    #[serde(default)]
    links: Vec<GitLabAssetLink>,
}

#[derive(Debug, Deserialize)]
struct GitLabAssetLink {
    name: String,
    url: String,
    direct_asset_url: Option<String>,
}

#[derive(Debug, Clone)]
struct ReleaseCandidate {
    version: Version,
    tag: String,
    name: String,
    notes: String,
    asset_name: Option<String>,
    asset_url: Option<String>,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    available: bool,
    release_name: String,
    release_notes: String,
    release_url: String,
    can_download: bool,
    asset_name: Option<String>,
    checksum_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub version: String,
    pub path: String,
    pub sha256: String,
}

pub struct UpdateState(pub Mutex<Option<DownloadedUpdate>>);

impl Default for UpdateState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("iBM-Lab-Agent/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("无法创建更新请求：{error}"))
}

fn parse_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().trim_start_matches(['v', 'V']))
        .map_err(|_| format!("GitLab 发布版本格式无效：{value}"))
}

fn extract_sha256(description: &str) -> Option<String> {
    description
        .split(|ch: char| !ch.is_ascii_hexdigit())
        .find(|token| token.len() == 64)
        .map(|token| token.to_ascii_lowercase())
}

fn installer_score(link: &GitLabAssetLink) -> Option<u8> {
    let value = format!(
        "{} {} {}",
        link.name,
        link.url,
        link.direct_asset_url.as_deref().unwrap_or("")
    )
    .to_ascii_lowercase();
    if !value.contains(".exe") {
        return None;
    }
    let mut score = 1;
    if value.contains("x64") || value.contains("x86_64") {
        score += 4;
    }
    if value.contains("setup") || value.contains("安装包") {
        score += 2;
    }
    Some(score)
}

fn validate_asset_url(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "GitLab 安装包链接无效".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("git.ustc.edu.cn") {
        return Err("GitLab 安装包必须来自 git.ustc.edu.cn 的 HTTPS 地址".to_string());
    }
    if !url.path().starts_with("/qbdeng2025/iBM-Lab-Agent/") {
        return Err("GitLab 安装包不属于 iBM-Lab-Agent 项目".to_string());
    }
    Ok(url.to_string())
}

fn fetch_candidate() -> Result<ReleaseCandidate, String> {
    let response = client()?
        .get(RELEASE_API)
        .send()
        .map_err(|error| format!("无法连接 GitLab：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("GitLab 更新检查失败（HTTP {}）", response.status()));
    }
    let body = response
        .text()
        .map_err(|error| format!("无法读取 GitLab Release 信息：{error}"))?;
    let release: GitLabRelease = serde_json::from_str(&body)
        .map_err(|error| format!("无法解析 GitLab Release 信息：{error}"))?;
    let version = parse_version(&release.tag_name)?;
    let selected = release
        .assets
        .links
        .iter()
        .filter_map(|link| installer_score(link).map(|score| (score, link)))
        .max_by_key(|(score, _)| *score)
        .map(|(_, link)| link);
    let (asset_name, asset_url) = match selected {
        Some(link) => {
            let raw = link.direct_asset_url.as_deref().unwrap_or(&link.url);
            (Some(link.name.clone()), Some(validate_asset_url(raw)?))
        }
        None => (None, None),
    };
    let notes = release.description.unwrap_or_default();
    let sha256 = extract_sha256(&notes);
    Ok(ReleaseCandidate {
        version,
        tag: release.tag_name,
        name: release.name,
        notes,
        asset_name,
        asset_url,
        sha256,
    })
}

pub fn check() -> Result<UpdateInfo, String> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("当前应用版本无效：{error}"))?;
    let release = fetch_candidate()?;
    let available = release.version > current;
    Ok(UpdateInfo {
        current_version: current.to_string(),
        latest_version: release.version.to_string(),
        available,
        release_name: release.name,
        release_notes: release.notes,
        release_url: format!("{RELEASE_BASE}{}", release.tag),
        can_download: available && release.asset_url.is_some() && release.sha256.is_some(),
        asset_name: release.asset_name,
        checksum_available: release.sha256.is_some(),
    })
}

fn unique_destination(directory: &Path, version: &Version) -> PathBuf {
    let base = format!("iBM-Lab-Agent_{}_x64-setup", version);
    let first = directory.join(format!("{base}.exe"));
    if !first.exists() {
        return first;
    }
    (1..1000)
        .map(|index| directory.join(format!("{base} ({index}).exe")))
        .find(|path| !path.exists())
        .unwrap_or_else(|| directory.join(format!("{base}-new.exe")))
}

pub fn download(app: &tauri::AppHandle) -> Result<DownloadedUpdate, String> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("当前应用版本无效：{error}"))?;
    let release = fetch_candidate()?;
    if release.version <= current {
        return Err(format!(
            "当前版本 {current} 已不低于 GitLab 最新版本 {}",
            release.version
        ));
    }
    let asset_url = release
        .asset_url
        .ok_or_else(|| "最新 Release 没有 Windows x64 安装包".to_string())?;
    let expected_hash = release
        .sha256
        .ok_or_else(|| "Release 未提供 SHA-256，已拒绝下载更新".to_string())?;
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法定位下载目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建下载目录：{error}"))?;
    let destination = unique_destination(&directory, &release.version);
    let partial = destination.with_extension("exe.part");
    let mut response = client()?
        .get(&asset_url)
        .send()
        .map_err(|error| format!("安装包下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("安装包下载失败（HTTP {}）", response.status()));
    }
    if response.url().scheme() != "https" {
        return Err("安装包下载被重定向到非 HTTPS 地址，已拒绝".to_string());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INSTALLER_BYTES)
    {
        return Err("安装包超过 1 GiB 安全上限".to_string());
    }
    let result = (|| -> Result<String, String> {
        let mut file =
            File::create(&partial).map_err(|error| format!("无法创建临时下载文件：{error}"))?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut buffer = [0u8; 128 * 1024];
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|error| format!("下载安装包时连接中断：{error}"))?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > MAX_INSTALLER_BYTES {
                return Err("安装包超过 1 GiB 安全上限".to_string());
            }
            file.write_all(&buffer[..count])
                .map_err(|error| format!("写入安装包失败：{error}"))?;
            hasher.update(&buffer[..count]);
        }
        file.flush()
            .map_err(|error| format!("保存安装包失败：{error}"))?;
        Ok(format!("{:x}", hasher.finalize()))
    })();
    let actual_hash = match result {
        Ok(hash) => hash,
        Err(error) => {
            let _ = fs::remove_file(&partial);
            return Err(error);
        }
    };
    if !actual_hash.eq_ignore_ascii_case(&expected_hash) {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "安装包 SHA-256 校验失败（期望 {expected_hash}，实际 {actual_hash}）"
        ));
    }
    fs::rename(&partial, &destination).map_err(|error| {
        let _ = fs::remove_file(&partial);
        format!("无法完成安装包保存：{error}")
    })?;
    Ok(DownloadedUpdate {
        version: release.version.to_string(),
        path: destination.display().to_string(),
        sha256: actual_hash,
    })
}

pub fn launch_installer(download: &DownloadedUpdate) -> Result<(), String> {
    let path = PathBuf::from(&download.path);
    if !path.is_file()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            != Some(true)
    {
        return Err("已下载的安装包不存在或格式无效，请重新下载".to_string());
    }
    let mut file = File::open(&path).map_err(|error| format!("无法读取安装包：{error}"))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|error| format!("无法复核安装包：{error}"))?;
    let actual_hash = format!("{:x}", hasher.finalize());
    if !actual_hash.eq_ignore_ascii_case(&download.sha256) {
        return Err("安装包在下载后发生变化，已拒绝启动".to_string());
    }
    std::process::Command::new(&path)
        .spawn()
        .map_err(|error| format!("无法启动安装程序：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_sha256, installer_score, parse_version, GitLabAssetLink};

    #[test]
    fn parses_release_versions_and_orders_prereleases() {
        assert!(parse_version("v0.5.2").unwrap() > parse_version("0.5.2-rc.1").unwrap());
        assert!(parse_version("v0.5.2-rc.2").unwrap() > parse_version("v0.5.2-rc.1").unwrap());
    }

    #[test]
    fn extracts_release_checksum() {
        let hash = "CA9A550C2862B7D10D46B1205AF1FE660D3E0DEB8523D1B100BD28DB39B810D7";
        assert_eq!(
            extract_sha256(&format!("SHA-256：`{hash}`")).unwrap(),
            hash.to_ascii_lowercase()
        );
        assert_eq!(extract_sha256("没有校验值"), None);
    }

    #[test]
    fn prefers_x64_setup_assets() {
        let setup = GitLabAssetLink {
            name: "Windows x64 安装包".into(),
            url: "https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/raw/assets/app_x64-setup.exe"
                .into(),
            direct_asset_url: None,
        };
        let other = GitLabAssetLink {
            name: "helper.exe".into(),
            url: "https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/raw/assets/helper.exe".into(),
            direct_asset_url: None,
        };
        assert!(installer_score(&setup).unwrap() > installer_score(&other).unwrap());
    }
}

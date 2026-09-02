//! Desktop-native artifact save/open/reveal routing (P1-4).

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{dsh::RuntimeLayout, RuntimeError};

const MAX_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TEXT_ARTIFACT_BYTES: usize = 16 * 1024 * 1024;
const ALLOWED_EXTENSIONS: [&str; 8] = ["docx", "pptx", "pdf", "zip", "ris", "bib", "txt", "md"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArtifact {
    pub cancelled: bool,
    pub file_name: String,
    pub file_path: Option<String>,
    pub bytes: u64,
    pub sha256: Option<String>,
}

fn is_loopback(host: Option<&str>) -> bool {
    matches!(
        host,
        Some("127.0.0.1") | Some("localhost") | Some("::1") | Some("[::1]")
    )
}

fn validate_artifact_url(raw: &str, expected_port: u16) -> Result<url::Url, RuntimeError> {
    let parsed = url::Url::parse(raw)
        .map_err(|error| RuntimeError::new(format!("Invalid artifact URL: {error}")))?;
    if parsed.scheme() != "http"
        || !is_loopback(parsed.host_str())
        || parsed.port_or_known_default() != Some(expected_port)
    {
        return Err(RuntimeError::new(
            "Artifact URL must use the active loopback runtime origin",
        ));
    }
    if !matches!(
        parsed.path(),
        "/api/lab-artifacts" | "/api/lab-literature-download"
    ) {
        return Err(RuntimeError::new("Artifact URL path is not allowed"));
    }
    Ok(parsed)
}

fn safe_file_name(raw: &str) -> Result<String, RuntimeError> {
    let decoded = percent_decode_str(raw).decode_utf8_lossy();
    let leaf = Path::new(decoded.as_ref())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let cleaned: String = leaf
        .chars()
        .filter(|ch| !ch.is_control() && !r#"<>:\\|?*"#.contains(*ch))
        .collect();
    let extension = Path::new(&cleaned)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if cleaned.is_empty() || !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(RuntimeError::new(
            "Server returned an unsupported artifact filename",
        ));
    }
    Ok(cleaned)
}

fn atomic_target(path: &Path) -> PathBuf {
    let nonce = format!(
        "{}.{}.part",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    path.with_file_name(format!(
        ".{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("artifact"),
        nonce
    ))
}

#[cfg(windows)]
fn finalize_atomic(temp: &Path, target: &Path) -> Result<(), RuntimeError> {
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
            "Cannot atomically replace selected file: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn finalize_atomic(temp: &Path, target: &Path) -> Result<(), RuntimeError> {
    fs::rename(temp, target)
        .map_err(|error| RuntimeError::new(format!("Cannot finalize selected file: {error}")))
}

pub fn save_artifact(raw_url: &str, expected_port: u16) -> Result<SavedArtifact, RuntimeError> {
    let url = validate_artifact_url(raw_url, expected_port)?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| {
            RuntimeError::new(format!("Cannot initialize artifact download: {error}"))
        })?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| RuntimeError::new(format!("Artifact download failed: {error}")))?;
    if !response.status().is_success() {
        return Err(RuntimeError::new(format!(
            "Artifact download failed (HTTP {})",
            response.status()
        )));
    }
    let expected_bytes = response.content_length();
    if expected_bytes.is_some_and(|size| size > MAX_ARTIFACT_BYTES) {
        return Err(RuntimeError::new(
            "Artifact exceeds the 256 MB desktop save limit",
        ));
    }
    let encoded_name = response
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("artifact.bin");
    let file_name = safe_file_name(encoded_name)?;
    let expected_hash = response
        .headers()
        .get("x-content-sha256")
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);
    let Some(target) = rfd::FileDialog::new().set_file_name(&file_name).save_file() else {
        return Ok(SavedArtifact {
            cancelled: true,
            file_name,
            file_path: None,
            bytes: 0,
            sha256: None,
        });
    };
    let temp = atomic_target(&target);
    let result = (|| {
        let mut output = File::create(&temp)
            .map_err(|error| RuntimeError::new(format!("Cannot create selected file: {error}")))?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let size = response.read(&mut buffer).map_err(|error| {
                RuntimeError::new(format!("Artifact download was interrupted: {error}"))
            })?;
            if size == 0 {
                break;
            }
            total += size as u64;
            if total > MAX_ARTIFACT_BYTES {
                return Err(RuntimeError::new(
                    "Artifact exceeds the 256 MB desktop save limit",
                ));
            }
            hasher.update(&buffer[..size]);
            output.write_all(&buffer[..size]).map_err(|error| {
                RuntimeError::new(format!("Cannot write selected file: {error}"))
            })?;
        }
        output
            .sync_all()
            .map_err(|error| RuntimeError::new(format!("Cannot flush selected file: {error}")))?;
        if expected_bytes.is_some_and(|size| size != total) {
            return Err(RuntimeError::new(
                "Artifact download is incomplete; selected file was not replaced",
            ));
        }
        let actual_hash = format!("{:x}", hasher.finalize());
        if expected_hash
            .as_deref()
            .is_some_and(|hash| hash != actual_hash)
        {
            return Err(RuntimeError::new(
                "Artifact SHA-256 verification failed; selected file was not replaced",
            ));
        }
        finalize_atomic(&temp, &target)?;
        Ok(SavedArtifact {
            cancelled: false,
            file_name,
            file_path: Some(target.display().to_string()),
            bytes: total,
            sha256: Some(actual_hash),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Save an in-memory RIS export through the native Windows save dialog.
/// Unlike binary artifacts this content has no loopback download URL, so it
/// must cross the authenticated iframe bridge as text.
pub fn save_text_artifact(raw_file_name: &str, text: &str) -> Result<SavedArtifact, RuntimeError> {
    let file_name = safe_file_name(raw_file_name)?;
    if !file_name.to_ascii_lowercase().ends_with(".ris") {
        return Err(RuntimeError::new("Only RIS text exports may be saved"));
    }
    let bytes = text.as_bytes();
    if bytes.len() > MAX_TEXT_ARTIFACT_BYTES {
        return Err(RuntimeError::new(
            "RIS export exceeds the 16 MB desktop save limit",
        ));
    }
    let Some(target) = rfd::FileDialog::new()
        .add_filter("RIS citation file", &["ris"])
        .set_file_name(&file_name)
        .save_file()
    else {
        return Ok(SavedArtifact {
            cancelled: true,
            file_name,
            file_path: None,
            bytes: 0,
            sha256: None,
        });
    };
    let temp = atomic_target(&target);
    let result = (|| {
        let mut output = File::create(&temp).map_err(|error| {
            RuntimeError::new(format!("Cannot create selected RIS file: {error}"))
        })?;
        output.write_all(bytes).map_err(|error| {
            RuntimeError::new(format!("Cannot write selected RIS file: {error}"))
        })?;
        output.sync_all().map_err(|error| {
            RuntimeError::new(format!("Cannot flush selected RIS file: {error}"))
        })?;
        let actual_hash = format!("{:x}", Sha256::digest(bytes));
        finalize_atomic(&temp, &target)?;
        Ok(SavedArtifact {
            cancelled: false,
            file_name,
            file_path: Some(target.display().to_string()),
            bytes: bytes.len() as u64,
            sha256: Some(actual_hash),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Fetch a loopback artifact into the app-owned transient cache and open it
/// with the Windows file association. No save dialog is shown.
pub fn open_artifact(
    raw_url: &str,
    expected_port: u16,
    cache_dir: &Path,
) -> Result<(), RuntimeError> {
    let url = validate_artifact_url(raw_url, expected_port)?;
    let response = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| RuntimeError::new(format!("Cannot initialize artifact request: {e}")))?
        .get(url)
        .send()
        .map_err(|e| RuntimeError::new(format!("Artifact open failed: {e}")))?;
    if !response.status().is_success() {
        return Err(RuntimeError::new(format!(
            "Artifact open failed (HTTP {})",
            response.status()
        )));
    }
    let file_name = safe_file_name(
        response
            .headers()
            .get("x-file-name")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("artifact.bin"),
    )?;
    let bytes = response
        .bytes()
        .map_err(|e| RuntimeError::new(format!("Artifact download was interrupted: {e}")))?;
    if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
        return Err(RuntimeError::new(
            "Artifact exceeds the 256 MB desktop open limit",
        ));
    }
    fs::create_dir_all(cache_dir)
        .map_err(|e| RuntimeError::new(format!("Cannot create artifact cache: {e}")))?;
    let target = cache_dir.join(format!("{}-{}", std::process::id(), file_name));
    fs::write(&target, &bytes)
        .map_err(|e| RuntimeError::new(format!("Cannot cache artifact for opening: {e}")))?;
    open_path(&target)
}

pub fn open_path(path: &Path) -> Result<(), RuntimeError> {
    if !path.exists() {
        return Err(RuntimeError::new(
            "The requested file or directory does not exist",
        ));
    }
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| {
            RuntimeError::new(format!("Cannot open path in Windows Shell: {error}"))
        })?;
    Ok(())
}

pub fn reveal_path(path: &Path) -> Result<(), RuntimeError> {
    if !path.is_file() {
        return Err(RuntimeError::new("The requested file does not exist"));
    }
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map_err(|error| {
            RuntimeError::new(format!("Cannot reveal file in Windows Explorer: {error}"))
        })?;
    Ok(())
}

pub fn open_workspace(layout: &RuntimeLayout, configured: &str) -> Result<(), RuntimeError> {
    let _ = configured; // desktop button always opens the project storage root
    let projects = layout.dsh_home.join("lab-agent").join("projects");
    fs::create_dir_all(&projects).map_err(|error| {
        RuntimeError::new(format!("Cannot create project storage directory: {error}"))
    })?;
    let path = projects.as_path();
    if !path.is_dir() {
        return Err(RuntimeError::new(
            "Configured workspace does not exist or is not a directory",
        ));
    }
    open_path(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_active_loopback_artifact_endpoints() {
        assert!(
            validate_artifact_url("http://127.0.0.1:3080/api/lab-artifacts?kind=pdf", 3080).is_ok()
        );
        assert!(validate_artifact_url(
            "http://localhost:3080/api/lab-literature-download?id=x",
            3080
        )
        .is_ok());
        assert!(validate_artifact_url("https://127.0.0.1:3080/api/lab-artifacts", 3080).is_err());
        assert!(validate_artifact_url("http://127.0.0.1:3081/api/lab-artifacts", 3080).is_err());
        assert!(validate_artifact_url("http://127.0.0.1:3080/admin", 3080).is_err());
    }

    #[test]
    fn sanitizes_and_restricts_server_filenames() {
        assert_eq!(
            safe_file_name("report%20one.docx").unwrap(),
            "report one.docx"
        );
        assert_eq!(safe_file_name("..%2Fpaper.pdf").unwrap(), "paper.pdf");
        assert!(safe_file_name("payload.exe").is_err());
        assert!(safe_file_name("artifact.bin").is_err());
    }

    #[test]
    fn ris_text_save_accepts_only_ris_names() {
        assert_eq!(safe_file_name("search-1.ris").unwrap(), "search-1.ris");
        assert_eq!(safe_file_name("检索结果.RIS").unwrap(), "检索结果.RIS");
        assert!(safe_file_name("search-1.exe").is_err());
        assert!(!"search-1.txt".to_ascii_lowercase().ends_with(".ris"));
    }
}

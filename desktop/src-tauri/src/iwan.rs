//! Panabit iWAN 本机状态探测。只读取网卡和系统路由，不接触账号、令牌或客户端配置。

use serde::Serialize;
use std::{
    env,
    path::PathBuf,
    ptr,
    time::{SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR},
    NetworkManagement::{
        IpHelper::{GetAdaptersAddresses, GetBestInterface, IP_ADAPTER_ADDRESSES_LH},
        Ndis::IfOperStatusUp,
    },
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IwanStatus {
    pub installed: bool,
    pub connected: bool,
    pub global_route: bool,
    pub usable: bool,
    pub adapter_name: Option<String>,
    pub message: String,
    pub checked_at: u64,
}

#[derive(Debug, Clone)]
struct AdapterSnapshot {
    name: String,
    description: String,
    if_index: u32,
    up: bool,
}

fn utf16_ptr_to_string(value: *const u16) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    unsafe {
        while *value.add(len) != 0 && len < 32_768 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(value, len))
    }
}

fn panabit_install_path() -> Option<PathBuf> {
    env::var_os("ProgramFiles(x86)")
        .map(PathBuf::from)
        .map(|root| root.join("Panabit").join("mobile_client.exe"))
}

fn adapters() -> Result<Vec<AdapterSnapshot>, String> {
    let mut size = 16 * 1024u32;
    for _ in 0..3 {
        // IP_ADAPTER_ADDRESSES 需要指针对齐；u64 backing 同时满足大小与对齐要求。
        let mut buffer = vec![0u64; (size as usize).div_ceil(std::mem::size_of::<u64>())];
        let result = unsafe {
            GetAdaptersAddresses(
                0,
                0,
                ptr::null(),
                buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>(),
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result != NO_ERROR {
            return Err(format!("读取网络适配器失败（{result}）"));
        }
        let mut rows = Vec::new();
        let mut current = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        unsafe {
            while !current.is_null() {
                let row = &*current;
                rows.push(AdapterSnapshot {
                    name: utf16_ptr_to_string(row.FriendlyName),
                    description: utf16_ptr_to_string(row.Description),
                    if_index: row.Anonymous1.Anonymous.IfIndex,
                    up: row.OperStatus == IfOperStatusUp,
                });
                current = row.Next;
            }
        }
        return Ok(rows);
    }
    Err("读取网络适配器时缓冲区持续变化".to_string())
}

fn is_panabit(row: &AdapterSnapshot) -> bool {
    let evidence = format!("{} {}", row.name, row.description).to_ascii_lowercase();
    evidence.contains("panabit") || evidence.contains("iwan")
}

fn public_route_interface() -> Option<u32> {
    // 1.1.1.1 只用于查询 Windows 路由表，不会发起网络连接。
    let destination = u32::from_ne_bytes([1, 1, 1, 1]);
    let mut index = 0u32;
    (unsafe { GetBestInterface(destination, &mut index) } == NO_ERROR).then_some(index)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn classify(
    rows: &[AdapterSnapshot],
    installed_on_disk: bool,
    route_index: Option<u32>,
) -> IwanStatus {
    let adapter = rows.iter().find(|row| is_panabit(row));
    let installed = installed_on_disk || adapter.is_some();
    let connected = adapter.is_some_and(|row| row.up);
    let global_route = adapter
        .zip(route_index)
        .is_some_and(|(row, route)| row.up && row.if_index == route);
    let message = if global_route {
        "iWAN 已连接，全部路由生效；文献将直接访问出版社".to_string()
    } else if connected {
        "iWAN 已连接，但公网未走隧道；请在客户端选择“全部路由”并应用".to_string()
    } else if installed {
        "已检测到 Panabit iWAN，当前未连接".to_string()
    } else {
        "未检测到 Panabit iWAN 客户端".to_string()
    };
    IwanStatus {
        installed,
        connected,
        global_route,
        usable: global_route,
        adapter_name: adapter.map(|row| row.name.clone()),
        message,
        checked_at: now(),
    }
}

pub fn status() -> IwanStatus {
    let installed = panabit_install_path().is_some_and(|path| path.is_file());
    match adapters() {
        Ok(rows) => classify(&rows, installed, public_route_interface()),
        Err(error) => IwanStatus {
            installed,
            connected: false,
            global_route: false,
            usable: false,
            adapter_name: None,
            message: error,
            checked_at: now(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(up: bool) -> AdapterSnapshot {
        AdapterSnapshot {
            name: "Panabit".to_string(),
            description: "PanabitTun Tunnel".to_string(),
            if_index: 46,
            up,
        }
    }

    #[test]
    fn disconnected_client_is_not_usable() {
        let status = classify(&[row(false)], true, Some(6));
        assert!(status.installed);
        assert!(!status.connected);
        assert!(!status.usable);
    }

    #[test]
    fn split_route_does_not_bypass_webvpn() {
        let status = classify(&[row(true)], true, Some(6));
        assert!(status.connected);
        assert!(!status.global_route);
        assert!(!status.usable);
    }

    #[test]
    fn global_panabit_route_can_bypass_webvpn() {
        let status = classify(&[row(true)], true, Some(46));
        assert!(status.connected);
        assert!(status.global_route);
        assert!(status.usable);
    }
}

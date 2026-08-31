use std::net::TcpListener;
use super::RuntimeError;

pub fn find_available_port(first: u16, count: u16) -> Result<u16, RuntimeError> {
    for port in first..first.saturating_add(count) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() { return Ok(port); }
    }
    Err(RuntimeError::new(format!("No available localhost port in range {first}-{}", first.saturating_add(count).saturating_sub(1))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_a_loopback_port() { assert!(find_available_port(3080, 32).is_ok()); }
}

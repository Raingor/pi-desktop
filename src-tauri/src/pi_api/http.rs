use std::time::Duration;

/// Detect system proxy URL from env vars or macOS scutil.
pub fn detect_proxy_url() -> Option<String> {
    // Check environment variables
    for var in &["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"] {
        if let Ok(val) = std::env::var(var) {
            if val.starts_with("http") {
                return Some(val);
            }
        }
    }

    // macOS: scutil --proxy
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("scutil")
            .arg("--proxy")
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);

            let get = |key: &str| -> Option<String> {
                text.lines()
                    .find(|l| l.trim_start().starts_with(key))
                    .and_then(|l| l.split(':').nth(1))
                    .map(|s| s.trim().to_string())
            };

            if get("HTTPSEnable").as_deref() == Some("1") {
                let host = get("HTTPSProxy");
                let port = get("HTTPSPort").unwrap_or_else(|| "80".to_string());
                if let Some(host) = host {
                    return Some(format!("http://{}:{}", host, port));
                }
            }

            if get("HTTPEnable").as_deref() == Some("1") {
                let host = get("HTTPProxy");
                let port = get("HTTPPort").unwrap_or_else(|| "80".to_string());
                if let Some(host) = host {
                    return Some(format!("http://{}:{}", host, port));
                }
            }
        }
    }

    None
}

/// Build a reqwest client with proxy support.
pub fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(10));

    if let Some(proxy_url) = detect_proxy_url() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder.build().map_err(|e| format!("Build HTTP client: {}", e))
}

/// Resolve $ENV_VAR style API keys.
pub fn resolve_api_key(key: &str) -> String {
    if key.starts_with('$') {
        std::env::var(&key[1..]).unwrap_or_default()
    } else {
        key.to_string()
    }
}

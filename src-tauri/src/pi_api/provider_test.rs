use serde::Serialize;
use crate::pi_api::http::{build_client, resolve_api_key};

#[derive(Serialize, Clone)]
pub struct ProviderTestResult {
    pub success: bool,
    pub status: Option<u16>,
    pub latency_ms: Option<u16>,
    pub message: Option<String>,
}

/// Test provider connectivity: GET {baseUrl}/models
#[tauri::command]
pub async fn pi_test_provider(
    base_url: String,
    api_key: Option<String>,
) -> Result<ProviderTestResult, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let key = api_key.as_deref().map(resolve_api_key).unwrap_or_default();

    let client = build_client(10)?;
    let mut req = client.get(&url);
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }

    let start = std::time::Instant::now();
    match req.send().await {
        Ok(res) => {
            let latency = start.elapsed().as_millis() as u16;
            let status_code = res.status().as_u16();
            if res.status().is_success() {
                Ok(ProviderTestResult {
                    success: true,
                    status: Some(status_code),
                    latency_ms: Some(latency),
                    message: None,
                })
            } else {
                let msg = format!("HTTP {}", status_code);
                Ok(ProviderTestResult {
                    success: false,
                    status: Some(status_code),
                    latency_ms: Some(latency),
                    message: Some(msg),
                })
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u16;
            Ok(ProviderTestResult {
                success: false,
                status: None,
                latency_ms: Some(latency),
                message: Some(e.to_string()),
            })
        }
    }
}

/// Test a specific model: POST {baseUrl}/chat/completions
#[tauri::command]
pub async fn pi_test_model(
    base_url: String,
    model_id: String,
    api_key: Option<String>,
    api_type: String,
) -> Result<ProviderTestResult, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let key = api_key.as_deref().map(resolve_api_key).unwrap_or_default();

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    // Anthropic uses x-api-key header
    if api_type == "anthropic-messages" || base_url.contains("anthropic") {
        if !key.is_empty() {
            headers.insert(
                "x-api-key",
                reqwest::header::HeaderValue::from_str(&key).map_err(|e| e.to_string())?,
            );
            headers.insert(
                "anthropic-version",
                reqwest::header::HeaderValue::from_static("2023-06-01"),
            );
        }
    } else if !key.is_empty() {
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", key))
                .map_err(|e| e.to_string())?,
        );
    }

    let body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "Reply with a single word: ok"}],
        "max_tokens": 4,
        "temperature": 0
    });

    let client = build_client(15)?;
    let start = std::time::Instant::now();

    match client.post(&url).headers(headers).json(&body).send().await {
        Ok(res) => {
            let latency = start.elapsed().as_millis() as u16;
            if res.status().is_success() {
                Ok(ProviderTestResult {
                    success: true,
                    status: Some(res.status().as_u16()),
                    latency_ms: Some(latency),
                    message: None,
                })
            } else {
                Ok(ProviderTestResult {
                    success: false,
                    status: Some(res.status().as_u16()),
                    latency_ms: Some(latency),
                    message: Some(format!("HTTP {}", res.status())),
                })
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u16;
            Ok(ProviderTestResult {
                success: false,
                status: None,
                latency_ms: Some(latency),
                message: Some(e.to_string()),
            })
        }
    }
}

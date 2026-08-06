use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use chrono::Timelike;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct UsageRecord {
    pub date: String,
    pub hour: Option<u32>,
    pub provider_id: String,
    pub model_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub requests: u64,
    pub cost: f64,
}

#[derive(Serialize, Clone)]
pub struct DailyAggregate {
    pub date: String,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Serialize, Clone)]
pub struct ProviderSummary {
    pub provider_id: String,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_requests: u64,
}

#[derive(Serialize, Clone)]
pub struct ModelSummary {
    pub model_id: String,
    pub provider_id: String,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_requests: u64,
    pub avg_tokens_per_request: u64,
}

#[derive(Serialize, Clone)]
pub struct Totals {
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_requests: u64,
}

#[derive(Serialize, Clone)]
pub struct UsageData {
    pub daily_aggregates: Vec<DailyAggregate>,
    pub provider_summaries: Vec<ProviderSummary>,
    pub model_summaries: Vec<ModelSummary>,
    pub totals: Totals,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageRangeData {
    pub total_tokens: u64,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cache_read: u64,
    pub total_cache_write: u64,
    pub total_cost: f64,
    pub total_requests: u64,
    pub cache_hit_rate: f64,
    pub daily_breakdown: Vec<DailyBreakdown>,
    pub hourly_breakdown: Vec<HourlyBreakdown>,
    pub request_log: Vec<RequestLogEntry>,
    pub provider_stats: Vec<ProviderStatEntry>,
    pub model_stats: Vec<ModelStatEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyBreakdown {
    pub date: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost: f64,
    pub requests: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HourlyBreakdown {
    pub hour: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost: f64,
    pub requests: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogEntry {
    pub timestamp: String,
    pub provider_id: String,
    pub model_id: String,
    pub input: u64,
    pub output: u64,
    pub cost: f64,
    pub requests: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatEntry {
    pub provider_id: String,
    pub total_tokens: u64,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cost: f64,
    pub total_requests: u64,
    pub model_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatEntry {
    pub model_id: String,
    pub provider_id: String,
    pub total_tokens: u64,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cost: f64,
    pub total_requests: u64,
}

// ─── Cache ──────────────────────────────────────────────

use std::sync::Mutex;

lazy_static::lazy_static! {
    /// Cached pre-computed usage data (refreshed every 30s or on demand)
    static ref USAGE_CACHE: Mutex<Option<(UsageStats, std::time::Instant)>> = Mutex::new(None);
}

/// Pre-computed usage statistics.
#[derive(Clone)]
pub struct UsageStats {
    pub records: Vec<UsageRecord>,
    pub daily_aggregates: Vec<DailyAggregate>,
    pub provider_summaries: Vec<ProviderSummary>,
    pub model_summaries: Vec<ModelSummary>,
    pub totals: Totals,
}

/// Read all usage records (with 30s cache + pre-computed aggregates).
pub fn read_all_usage() -> Result<Vec<UsageRecord>, String> {
    let stats = read_usage_stats()?;
    Ok(stats.records)
}

/// Read pre-computed usage stats (cached for 30 seconds).
pub fn read_usage_stats() -> Result<UsageStats, String> {
    // Check cache
    {
        let cache = USAGE_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((ref stats, ref at)) = *cache {
            if at.elapsed() < std::time::Duration::from_secs(30) {
                return Ok(stats.clone());
            }
        }
    }

    let stats = compute_usage_stats()?;

    // Update cache
    {
        let mut cache = USAGE_CACHE.lock().map_err(|e| e.to_string())?;
        *cache = Some((stats.clone(), std::time::Instant::now()));
    }

    Ok(stats)
}

/// Invalidate cache (called after data changes).
pub fn invalidate_usage_cache() {
    if let Ok(mut cache) = USAGE_CACHE.lock() {
        *cache = None;
    }
}

/// Compute usage stats from JSONL files.
fn compute_usage_stats() -> Result<UsageStats, String> {
    let records = read_all_usage_uncached()?;

    // Pre-compute aggregates
    let daily_aggregates = get_daily_aggregates(&records);
    let provider_summaries = get_provider_summaries(&records);
    let model_summaries = get_model_summaries(&records);
    let totals = get_totals(&records);

    Ok(UsageStats {
        records,
        daily_aggregates,
        provider_summaries,
        model_summaries,
        totals,
    })
}

/// Read all usage records without caching.
/// Only reads .jsonl files directly in session directories (not subdirectories like run-0/).
fn read_all_usage_uncached() -> Result<Vec<UsageRecord>, String> {
    let sessions_dir = pi_dir().join("sessions");
    if !sessions_dir.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::with_capacity(1024); // Pre-allocate

    // Get session directories (starting with "--")
    let session_dirs = match std::fs::read_dir(&sessions_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name().to_string_lossy().starts_with("--")
                    && e.file_type().map(|t| t.is_dir()).unwrap_or(false)
            })
            .collect::<Vec<_>>(),
        Err(_) => return Ok(records),
    };

    // Read .jsonl files directly in each session directory
    for dir in session_dirs {
        let dir_path = dir.path();
        let files = match std::fs::read_dir(&dir_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for file in files.filter_map(|e| e.ok()) {
            let path = file.path();
            if path.extension().map_or(false, |e| e == "jsonl") {
                let file_records = parse_session_file(&path);
                records.extend(file_records);
            }
        }
    }

    records.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(records)
}

/// Parse a single JSONL session file into usage records.
fn parse_session_file(path: &Path) -> Vec<UsageRecord> {
    let mut records = Vec::new();
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return records,
    };

    let reader = BufReader::new(file);
    let mut current_provider = "unknown".to_string();
    let mut current_model = "unknown".to_string();

    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };

        let obj: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = obj["type"].as_str().unwrap_or("");

        if event_type == "model_change" {
            if let Some(p) = obj["provider"].as_str() {
                current_provider = p.to_string();
            }
            if let Some(m) = obj["model_id"].as_str() {
                current_model = m.to_string();
            }
            continue;
        }

        if event_type == "message" {
            let message = match obj.get("message") {
                Some(m) => m,
                None => continue,
            };

            if message["role"].as_str() != Some("assistant") {
                continue;
            }

            let usage = match message.get("usage") {
                Some(u) if u.get("input").and_then(|v| v.as_u64()).unwrap_or(0) > 0 => u,
                _ => continue,
            };

            let timestamp = obj["timestamp"]
                .as_str()
                .or_else(|| message["timestamp"].as_str())
                .unwrap_or("");

            let (date, hour) = parse_timestamp(timestamp);

            records.push(UsageRecord {
                date,
                hour,
                provider_id: message["provider"].as_str().unwrap_or(&current_provider).to_string(),
                model_id: message["model"].as_str().unwrap_or(&current_model).to_string(),
                input_tokens: usage["input"].as_u64().unwrap_or(0),
                output_tokens: usage["output"].as_u64().unwrap_or(0),
                cache_read_tokens: usage["cacheRead"].as_u64().unwrap_or(0),
                cache_write_tokens: usage["cacheWrite"].as_u64().unwrap_or(0),
                requests: 1,
                cost: usage["cost"]["total"].as_f64().unwrap_or(0.0),
            });
        }
    }

    records
}

/// Parse an ISO timestamp into (date_string, hour).
fn parse_timestamp(ts: &str) -> (String, Option<u32>) {
    if ts.is_empty() {
        return ("unknown".to_string(), None);
    }

    // Try parsing with chrono
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        let local = dt.with_timezone(&chrono::Local);
        return (
            local.format("%Y-%m-%d").to_string(),
            Some(local.time().hour()),
        );
    }

    // Fallback: try to extract date from "YYYY-MM-DD..." format
    if ts.len() >= 10 {
        let date = ts[..10].to_string();
        let hour = if ts.len() >= 13 {
            ts[11..13].parse::<u32>().ok()
        } else {
            None
        };
        return (date, hour);
    }

    ("unknown".to_string(), None)
}

// ─── Aggregation Helpers ────────────────────────────────

pub fn get_daily_aggregates(records: &[UsageRecord]) -> Vec<DailyAggregate> {
    let mut map: HashMap<String, DailyAggregate> = HashMap::new();

    for r in records {
        let entry = map.entry(r.date.clone()).or_insert_with(|| DailyAggregate {
            date: r.date.clone(),
            total_tokens: 0,
            total_cost: 0.0,
            total_requests: 0,
            input_tokens: 0,
            output_tokens: 0,
        });
        entry.total_tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        entry.total_cost += r.cost;
        entry.total_requests += r.requests;
        entry.input_tokens += r.input_tokens;
        entry.output_tokens += r.output_tokens;
    }

    let mut result: Vec<_> = map.into_values().collect();
    result.sort_by(|a, b| a.date.cmp(&b.date));
    result
}

pub fn get_provider_summaries(records: &[UsageRecord]) -> Vec<ProviderSummary> {
    let mut map: HashMap<String, ProviderSummary> = HashMap::new();

    for r in records {
        let entry = map.entry(r.provider_id.clone()).or_insert_with(|| ProviderSummary {
            provider_id: r.provider_id.clone(),
            total_tokens: 0,
            total_cost: 0.0,
            total_requests: 0,
        });
        entry.total_tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        entry.total_cost += r.cost;
        entry.total_requests += r.requests;
    }

    let mut result: Vec<_> = map.into_values().collect();
    result.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(std::cmp::Ordering::Equal));
    result
}

pub fn get_model_summaries(records: &[UsageRecord]) -> Vec<ModelSummary> {
    let mut map: HashMap<String, ModelSummary> = HashMap::new();

    for r in records {
        let key = format!("{}/{}", r.provider_id, r.model_id);
        let entry = map.entry(key).or_insert_with(|| ModelSummary {
            model_id: r.model_id.clone(),
            provider_id: r.provider_id.clone(),
            total_tokens: 0,
            total_cost: 0.0,
            total_requests: 0,
            avg_tokens_per_request: 0,
        });
        entry.total_tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        entry.total_cost += r.cost;
        entry.total_requests += r.requests;
    }

    let mut result: Vec<_> = map.into_values().collect();
    for m in &mut result {
        if m.total_requests > 0 {
            m.avg_tokens_per_request = m.total_tokens / m.total_requests;
        }
    }
    result.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(std::cmp::Ordering::Equal));
    result
}

pub fn get_totals(records: &[UsageRecord]) -> Totals {
    let mut totals = Totals {
        total_tokens: 0,
        total_cost: 0.0,
        total_requests: 0,
    };

    for r in records {
        totals.total_tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        totals.total_cost += r.cost;
        totals.total_requests += r.requests;
    }

    totals
}

// ─── Commands ───────────────────────────────────────────

/// Async wrapper: run blocking I/O on a thread pool so the UI thread
/// is never blocked by JSONL file parsing (can be slow with 200+ MB of data).
#[tauri::command]
pub async fn pi_usage_get() -> Result<UsageData, String> {
    let stats = tokio::task::spawn_blocking(|| read_usage_stats())
        .await
        .map_err(|e| format!("spawn_blocking: {}", e))??;
    Ok(UsageData {
        daily_aggregates: stats.daily_aggregates,
        provider_summaries: stats.provider_summaries,
        model_summaries: stats.model_summaries,
        totals: stats.totals,
    })
}

#[tauri::command]
pub async fn pi_usage_range_get(range: String, from: String, to: String) -> Result<UsageRangeData, String> {
    // Run the heavy file-read + aggregation on a blocking thread
    let records = tokio::task::spawn_blocking(|| read_all_usage())
        .await
        .map_err(|e| format!("spawn_blocking: {}", e))??;

    // Resolve date range
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let (from_date, to_date) = match range.as_str() {
        "today" => (today.clone(), today),
        "7d" => {
            let d = chrono::Local::now() - chrono::Duration::days(6);
            (d.format("%Y-%m-%d").to_string(), today)
        }
        "30d" => {
            let d = chrono::Local::now() - chrono::Duration::days(29);
            (d.format("%Y-%m-%d").to_string(), today)
        }
        "custom" => {
            if from.is_empty() {
                (today.clone(), today)
            } else {
                let t = if to.is_empty() { from.clone() } else { to };
                (from, t)
            }
        }
        _ => (today.clone(), today),
    };

    let filtered: Vec<_> = records.iter()
        .filter(|r| r.date >= from_date && r.date <= to_date)
        .cloned()
        .collect();

    let total_input: u64 = filtered.iter().map(|r| r.input_tokens).sum();
    let total_output: u64 = filtered.iter().map(|r| r.output_tokens).sum();
    let total_cache_read: u64 = filtered.iter().map(|r| r.cache_read_tokens).sum();
    let total_cache_write: u64 = filtered.iter().map(|r| r.cache_write_tokens).sum();
    let total_cost: f64 = filtered.iter().map(|r| r.cost).sum();
    let total_requests: u64 = filtered.iter().map(|r| r.requests).sum();
    let total_tokens = total_input + total_output + total_cache_read + total_cache_write;
    let cache_hit_rate = if total_tokens > 0 {
        ((total_cache_read + total_cache_write) as f64 / total_tokens as f64) * 100.0
    } else {
        0.0
    };

    // Daily breakdown
    let mut daily_map: HashMap<String, DailyBreakdown> = HashMap::new();
    for r in &filtered {
        let entry = daily_map.entry(r.date.clone()).or_insert_with(|| DailyBreakdown {
            date: r.date.clone(),
            input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0.0, requests: 0,
        });
        entry.input += r.input_tokens;
        entry.output += r.output_tokens;
        entry.cache_read += r.cache_read_tokens;
        entry.cache_write += r.cache_write_tokens;
        entry.cost += r.cost;
        entry.requests += r.requests;
    }
    let mut daily_breakdown: Vec<_> = daily_map.into_values().collect();
    daily_breakdown.sort_by(|a, b| a.date.cmp(&b.date));

    // Hourly breakdown
    let mut hourly_map: HashMap<String, HourlyBreakdown> = HashMap::new();
    for r in &filtered {
        if let Some(h) = r.hour {
            let key = format!("{} {:02}:00", r.date, h);
            let entry = hourly_map.entry(key.clone()).or_insert_with(|| HourlyBreakdown {
                hour: key, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0.0, requests: 0,
            });
            entry.input += r.input_tokens;
            entry.output += r.output_tokens;
            entry.cache_read += r.cache_read_tokens;
            entry.cache_write += r.cache_write_tokens;
            entry.cost += r.cost;
            entry.requests += r.requests;
        }
    }
    let mut hourly_breakdown: Vec<_> = hourly_map.into_values().collect();
    hourly_breakdown.sort_by(|a, b| a.hour.cmp(&b.hour));

    // Request log (grouped by date+provider+model)
    let mut log_map: HashMap<String, RequestLogEntry> = HashMap::new();
    for r in &filtered {
        let key = format!("{}|{}|{}", r.date, r.provider_id, r.model_id);
        let entry = log_map.entry(key).or_insert_with(|| RequestLogEntry {
            timestamp: r.date.clone(),
            provider_id: r.provider_id.clone(),
            model_id: r.model_id.clone(),
            input: 0, output: 0, cost: 0.0, requests: 0,
        });
        entry.input += r.input_tokens;
        entry.output += r.output_tokens;
        entry.cost += r.cost;
        entry.requests += r.requests;
    }
    let mut request_log: Vec<_> = log_map.into_values().collect();
    request_log.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // Provider stats
    let mut pstats_map: HashMap<String, (u64, u64, u64, f64, u64, Vec<String>)> = HashMap::new();
    for r in &filtered {
        let entry = pstats_map.entry(r.provider_id.clone()).or_insert((0, 0, 0, 0.0, 0, Vec::new()));
        entry.0 += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        entry.1 += r.input_tokens;
        entry.2 += r.output_tokens;
        entry.3 += r.cost;
        entry.4 += r.requests;
        if !entry.5.contains(&r.model_id) { entry.5.push(r.model_id.clone()); }
    }
    let provider_stats: Vec<ProviderStatEntry> = pstats_map.into_iter()
        .map(|(pid, (tt, ti, to, tc, tr, models))| ProviderStatEntry {
            provider_id: pid, total_tokens: tt, total_input: ti, total_output: to,
            total_cost: tc, total_requests: tr, model_count: models.len(),
        })
        .collect();

    // Model stats: (model_id, provider_id, total_tokens, input_tokens, cost, requests)
    let mut mstats_map: HashMap<String, (String, String, u64, u64, f64, u64)> = HashMap::new();
    for r in &filtered {
        let key = format!("{}/{}", r.provider_id, r.model_id);
        let entry = mstats_map.entry(key).or_insert((
            r.model_id.clone(), r.provider_id.clone(), 0, 0, 0.0, 0,
        ));
        entry.2 += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
        entry.3 += r.input_tokens;
        entry.4 += r.cost;
        entry.5 += r.requests;
    }
    let model_stats: Vec<ModelStatEntry> = mstats_map.into_iter()
        .map(|(_, (mid, pid, tt, ti, tc, tr))| ModelStatEntry {
            model_id: mid, provider_id: pid, total_tokens: tt, total_input: ti,
            total_output: tt - ti, total_cost: tc, total_requests: tr,
        })
        .collect();

    Ok(UsageRangeData {
        total_tokens,
        total_input,
        total_output,
        total_cache_read,
        total_cache_write,
        total_cost,
        total_requests,
        cache_hit_rate: (cache_hit_rate * 10.0).round() / 10.0,
        daily_breakdown,
        hourly_breakdown,
        request_log,
        provider_stats,
        model_stats,
    })
}

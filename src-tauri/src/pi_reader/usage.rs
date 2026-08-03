use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use chrono::Timelike;
use walkdir::WalkDir;
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
pub struct ModelStatEntry {
    pub model_id: String,
    pub provider_id: String,
    pub total_tokens: u64,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cost: f64,
    pub total_requests: u64,
}

// ─── Core Functions ────────────────────────────────────

/// Read all usage records from session JSONL files.
pub fn read_all_usage() -> Result<Vec<UsageRecord>, String> {
    let sessions_dir = pi_dir().join("sessions");
    if !sessions_dir.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();

    for entry in WalkDir::new(&sessions_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().map_or(false, |ext| ext == "jsonl"))
    {
        let file_records = parse_session_file(entry.path());
        records.extend(file_records);
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

#[tauri::command]
pub fn pi_usage_get() -> Result<UsageData, String> {
    let records = read_all_usage()?;
    Ok(UsageData {
        daily_aggregates: get_daily_aggregates(&records),
        provider_summaries: get_provider_summaries(&records),
        model_summaries: get_model_summaries(&records),
        totals: get_totals(&records),
    })
}

#[tauri::command]
pub fn pi_usage_range_get(range: String, from: String, to: String) -> Result<UsageRangeData, String> {
    let records = read_all_usage()?;
    let filtered: Vec<_> = records.iter()
        .filter(|r| r.date >= from && r.date <= to)
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

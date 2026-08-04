use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use crate::pi_reader::pi_dir;

// ─── Types ─────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentDef {
    pub name: String,
    pub file_name: String,
    pub file_path: String,
    pub package: String,
    pub description: String,
    pub model: Option<String>,
    pub tools: Option<Vec<String>>,
    pub thinking: Option<String>,
    pub system_prompt_mode: Option<String>,
    pub inherit_project_context: Option<bool>,
    pub inherit_skills: Option<bool>,
    pub input: Option<Vec<String>>,
    pub body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChainStep {
    pub agent: String,
    pub phase: Option<String>,
    pub label: Option<String>,
    pub output: Option<String>,
    pub as_: Option<String>,
    pub task: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChainDef {
    pub name: String,
    pub file_name: String,
    pub file_path: String,
    pub description: String,
    pub steps: Vec<ChainStep>,
    pub body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub agent: String,
    pub ts: i64,
    pub status: String,
    pub duration: Option<i64>,
    pub exit: Option<i32>,
    pub task_hash: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubagentsData {
    pub agents: Vec<AgentDef>,
    pub chains: Vec<ChainDef>,
    pub run_history: Vec<RunRecord>,
}

// ─── Helpers ────────────────────────────────────────────

fn agents_dir() -> PathBuf {
    pi_dir().join("agents")
}

fn chains_dir() -> PathBuf {
    pi_dir().join("chains")
}

fn run_history_path() -> PathBuf {
    pi_dir().join("run-history.jsonl")
}

/// Parse YAML frontmatter from a markdown file.
fn parse_frontmatter(raw: &str) -> (serde_json::Value, String) {
    let mut frontmatter = serde_json::json!({});

    let first = raw.find("---").unwrap_or(1);
    if first != 0 {
        return (frontmatter, raw.to_string());
    }

    let after_first = &raw[3..];
    let second = match after_first.find("---") {
        Some(idx) => idx,
        None => return (frontmatter, raw.to_string()),
    };

    let yaml_block = &after_first[..second];
    let body = after_first[second + 3..].trim();

    for line in yaml_block.lines() {
        if let Some(colon_idx) = line.find(':') {
            let key = line[..colon_idx].trim().to_string();
            let value_str = line[colon_idx + 1..].trim();

            let value: serde_json::Value = if value_str.starts_with('[') && value_str.ends_with(']') {
                // Array: "[item1, item2]"
                let inner = &value_str[1..value_str.len() - 1];
                let items: Vec<serde_json::Value> = inner
                    .split(',')
                    .map(|s| {
                        let s = s.trim().trim_matches('"').trim_matches('\'');
                        serde_json::Value::String(s.to_string())
                    })
                    .collect();
                serde_json::Value::Array(items)
            } else if value_str == "true" {
                serde_json::Value::Bool(true)
            } else if value_str == "false" {
                serde_json::Value::Bool(false)
            } else if let Ok(n) = value_str.parse::<i64>() {
                serde_json::Value::Number(n.into())
            } else if let Ok(f) = value_str.parse::<f64>() {
                serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or_else(|| serde_json::Value::String(value_str.to_string()))
            } else {
                serde_json::Value::String(
                    value_str.trim_matches('"').trim_matches('\'').to_string()
                )
            };

            frontmatter[key] = value;
        }
    }

    (frontmatter, body.to_string())
}

fn split_comma_or_array(val: &serde_json::Value) -> Option<Vec<String>> {
    match val {
        serde_json::Value::Array(arr) => Some(
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        ),
        serde_json::Value::String(s) if !s.trim().is_empty() => {
            Some(s.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
        }
        _ => None,
    }
}

// ─── Functions ──────────────────────────────────────────

fn list_agents() -> Vec<AgentDef> {
    let dir = agents_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let read_dir = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };

    read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().map_or(false, |e| e == "md")
        })
        .filter_map(|entry| {
            let file_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let raw = fs::read_to_string(&file_path).ok()?;
            let (fm, body) = parse_frontmatter(&raw);

            let name = fm["name"].as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| file_name.replace(".md", ""));

            Some(AgentDef {
                name,
                file_name,
                file_path: file_path.to_string_lossy().to_string(),
                package: fm["package"].as_str().unwrap_or("custom").to_string(),
                description: fm["description"].as_str().unwrap_or("").to_string(),
                model: fm["model"].as_str().map(|s| s.to_string()),
                tools: split_comma_or_array(&fm["tools"]),
                thinking: fm["thinking"].as_str().map(|s| s.to_string()),
                system_prompt_mode: fm["systemPromptMode"].as_str().map(|s| s.to_string()),
                inherit_project_context: fm["inheritProjectContext"].as_bool(),
                inherit_skills: fm["inheritSkills"].as_bool(),
                input: split_comma_or_array(&fm["input"]),
                body: body.chars().take(500).collect(),
            })
        })
        .collect()
}

fn list_chains() -> Vec<ChainDef> {
    let dir = chains_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let read_dir = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };

    read_dir
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.file_name().to_string_lossy().ends_with(".chain.md")
        })
        .filter_map(|entry| {
            let file_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let raw = fs::read_to_string(&file_path).ok()?;
            let (fm, body) = parse_frontmatter(&raw);

            let name = fm["name"].as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| file_name.replace(".chain.md", ""));

            let description = fm["description"].as_str().unwrap_or("").to_string();

            // Parse chain steps from ## headers in body
            let mut steps = Vec::new();
            for line in body.lines() {
                if let Some(rest) = line.strip_prefix("## ") {
                    let header = rest.trim();
                    // Check for parallel steps: "(agent1 | agent2)"
                    if let Some(start) = header.find('(') {
                        if let Some(pipe_end) = header.find(')') {
                            let inner = &header[start + 1..pipe_end];
                            for agent in inner.split('|') {
                                steps.push(ChainStep {
                                    agent: agent.trim().to_string(),
                                    phase: None,
                                    label: None,
                                    output: None,
                                    as_: None,
                                    task: None,
                                });
                            }
                            continue;
                        }
                    }
                    steps.push(ChainStep {
                        agent: header.to_string(),
                        phase: None,
                        label: None,
                        output: None,
                        as_: None,
                        task: None,
                    });
                }
            }

            Some(ChainDef {
                name,
                file_name,
                file_path: file_path.to_string_lossy().to_string(),
                description,
                steps,
                body: raw.chars().take(300).collect(),
            })
        })
        .collect()
}

fn read_run_history(limit: usize) -> Vec<RunRecord> {
    let path = run_history_path();
    if !path.exists() {
        return Vec::new();
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    lines
        .iter()
        .rev()
        .take(limit)
        .filter_map(|line| {
            if line.trim().is_empty() {
                return None;
            }
            let obj: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(RunRecord {
                agent: obj["agent"].as_str().unwrap_or("").to_string(),
                ts: obj["ts"].as_i64().unwrap_or(0),
                status: obj["status"].as_str().unwrap_or("").to_string(),
                duration: obj["duration"].as_i64(),
                exit: obj["exit"].as_i64().map(|v| v as i32),
                task_hash: obj["taskHash"].as_str().map(|s| s.to_string()),
            })
        })
        .collect()
}

// ─── Command ────────────────────────────────────────────

#[tauri::command]
pub fn pi_subagents_get() -> Result<SubagentsData, String> {
    Ok(SubagentsData {
        agents: list_agents(),
        chains: list_chains(),
        run_history: read_run_history(100),
    })
}

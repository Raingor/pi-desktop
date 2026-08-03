pub mod settings;
pub mod auth;
pub mod models;
pub mod usage;
pub mod sessions;
pub mod memory;
pub mod subagents;
pub mod update_check;
pub mod builtin_catalog;

use std::path::PathBuf;
use dirs::home_dir;

/// ~/.pi/agent/ — all pi data lives here
pub fn pi_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pi/agent")
}

pub fn pi_path(filename: &str) -> PathBuf {
    pi_dir().join(filename)
}

// ─── Config persistence helpers ──────────────────────────
// Pi config is now read/written directly to ~/.pi/agent/ via the API.
// This file provides localStorage-based import/export for backup.

import type { PiConfig, ExportPayload } from "@/types";

// ─── File System Access API type shims ──────────────────
// These APIs are Chromium-only; we gracefully fall back.

declare global {
  interface Window {
    showDirectoryPicker?(): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker?(options?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
      multiple?: boolean;
    }): Promise<FileSystemFileHandle[]>;
  }
}

const STORAGE_KEY = "pi-web-switch-config";

export function saveLocalBackup(config: PiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config, null, 2));
  } catch {
    // localStorage might be full
  }
}

export function loadLocalBackup(): PiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PiConfig;
  } catch {
    // ignore
  }
  return null;
}

export function exportConfig(config: PiConfig, filename?: string): void {
  const payload: ExportPayload = {
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    config,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `pi-web-switch-config-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportConfigToDirectory(config: PiConfig): Promise<{ ok: boolean; cancelled: boolean }> {
  if (!("showDirectoryPicker" in window)) return { ok: false, cancelled: false };
  try {
    const dirHandle = await window.showDirectoryPicker!();
    const fileName = `pi-web-switch-config-${new Date().toISOString().split("T")[0]}.json`;
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const payload: ExportPayload = {
      version: "0.1.0",
      exportedAt: new Date().toISOString(),
      config,
    };
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return { ok: true, cancelled: false };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, cancelled: true };
    }
    return { ok: false, cancelled: false };
  }
}

export async function importConfigFromFile(): Promise<{ config: PiConfig | null; cancelled: boolean }> {
  if (!("showOpenFilePicker" in window)) return { config: null, cancelled: false };
  try {
    const handles = await window.showOpenFilePicker!({
      types: [
        {
          description: "JSON Files",
          accept: { "application/json": [".json"] },
        },
      ],
      multiple: false,
    });
    const fileHandle = handles[0];
    if (!fileHandle) return { config: null, cancelled: false };
    const file = await fileHandle.getFile();
    const text = await file.text();
    return { config: parseImportFile(text), cancelled: false };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { config: null, cancelled: true };
    }
    return { config: null, cancelled: false };
  }
}

export function parseImportFile(json: string): PiConfig | null {
  try {
    const payload = JSON.parse(json) as ExportPayload;
    if (payload.config?.settings && payload.config?.auth) {
      return payload.config;
    }
    // Try raw config
    if (json.includes("defaultProvider")) {
      return JSON.parse(json) as PiConfig;
    }
    return null;
  } catch {
    return null;
  }
}

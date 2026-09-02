#!/usr/bin/env node
/**
 * Electron 开发启动脚本
 * 流程：启动 Vite dev server → 构建 main/preload → 启动 Electron 指向 dev server
 * 注意：本机可能全局设置了 ELECTRON_RUN_AS_NODE=1（会破坏 Electron 内置模块），
 *       启动 Electron 前必须清除该变量。
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5179";
const MAIN_DIR = path.join(root, "dist-electron", "main");
const PRELOAD_DIR = path.join(root, "dist-electron", "preload");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
}

// 1. 构建 Electron 主进程与 preload
console.log("▶ 构建 Electron 主进程/preload...");
const mainBuild = run("npx", ["vite", "build", "--config", "vite.electron.config.ts"]);
if (mainBuild.status !== 0) {
  console.error("✗ 主进程构建失败");
  process.exit(1);
}
const preloadBuild = run("npx", ["vite", "build", "--config", "vite.preload.config.ts"]);
if (preloadBuild.status !== 0) {
  console.error("✗ preload 构建失败");
  process.exit(1);
}

// 2. 将 preload.cjs 拷贝到主进程目录（主进程按 __dirname/preload.cjs 引用）
const mainEntry = path.join(MAIN_DIR, "main.cjs");
const preloadSrc = path.join(PRELOAD_DIR, "preload.cjs");
if (!fs.existsSync(mainEntry)) {
  console.error(`✗ 未找到 ${mainEntry}`);
  process.exit(1);
}
if (fs.existsSync(preloadSrc)) {
  fs.copyFileSync(preloadSrc, path.join(MAIN_DIR, "preload.cjs"));
  console.log("✓ preload.cjs 已拷贝到主进程目录");
}

// 3. 启动 Vite dev server（后台）
console.log("▶ 启动 Vite dev server...");
const vite = spawn("npx", ["vite"], { cwd: root, stdio: "inherit" });

// 4. 等待 dev server 就绪后启动 Electron
let electronStarted = false;
function tryStartElectron() {
  if (electronStarted) return;
  electronStarted = true;
  console.log(`▶ 启动 Electron → ${DEV_URL}`);
  const env = { ...process.env, VITE_DEV_SERVER_URL: DEV_URL };
  delete env.ELECTRON_RUN_AS_NODE; // 关键：清除会破坏 Electron 的变量
  const electron = spawn(
    path.join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
    [mainEntry],
    { cwd: root, stdio: "inherit", env }
  );
  electron.on("exit", () => {
    vite.kill();
    process.exit(0);
  });
}

// 轮询等待 dev server
const timer = setInterval(() => {
  const probe = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${DEV_URL}/`], { timeout: 3000 });
  const code = (probe.stdout || "").toString().trim();
  if (code === "200") {
    clearInterval(timer);
    tryStartElectron();
  }
}, 1000);

// 超时保护：15 秒后强制启动
setTimeout(tryStartElectron, 15000);

vite.on("exit", (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});

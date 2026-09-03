// Electron main process
// Use process.mainModule.require to access electron module within Electron
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, shell, screen } = (process as any).mainModule?.require('electron') || require('electron');
// Type-only import (erased at compile time) — does not affect the runtime require workaround above.
import type { BrowserWindow as BrowserWindowType, Tray as TrayType, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as piReader from '../server/pi-reader';
import { startApiServer } from './api-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persist startup diagnostics to a log file (GUI launches have no stdout).
const LOG_FILE = '/tmp/pi-desktop-app.log';
function log(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* best effort */ }
  console.log(...args);
}

// Keep global references to prevent garbage collection
let mainWindow: BrowserWindowType | null = null;
let popupWindow: BrowserWindowType | null = null;
let tray: TrayType | null = null;
let popupHideTimer: NodeJS.Timeout | null = null;
// Local HTTP server serving the built bundle + /api/pi/* routes in packaged mode
let apiServerUrl: string | null = null;

// ─── Path helpers ────────────────────────────────────────
// In dev, __dirname = <root>/dist-electron/main; in packaged builds it is
// inside app.asar with the same relative layout. Return the first existing
// candidate so dev (source tree) and prod (dist/) both resolve.

function pickPath(...candidates: string[]): string | null {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolvePreload(): string {
  return path.join(__dirname, '../preload/preload.cjs');
}

function resolveIndexHtml(): string {
  return path.join(__dirname, '../../dist/index.html');
}

function resolvePopupHtml(): string {
  return path.join(__dirname, '../../dist/electron/popup.html');
}

function resolveAppIcon(): string | null {
  return pickPath(
    path.join(__dirname, '../../public/icon-512.png'),
    path.join(__dirname, '../../dist/icon-512.png'),
  );
}

// ─── Tray icon (template image for macOS menu bar) ───────

function createTrayIcon() {
  // Dev: build/trayIconTemplate.png in the source tree.
  // Packaged: public/ assets are copied into dist/ by Vite.
  const iconPath = pickPath(
    path.join(__dirname, '../../build/trayIconTemplate.png'),
    path.join(__dirname, '../../dist/trayIconTemplate.png'),
    resolveAppIcon() ?? '',
  );
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  // template image = monochrome, adapts to light/dark menu bar
  image.setTemplateImage(true);
  return image;
}

// ─── Windows ─────────────────────────────────────────────

// ─── Theme-aware window chrome ───────────────────────────
// The frameless/inset title bar shows the window's backgroundColor, so it has
// to match the renderer's --page-bg or the top edge flashes white.
const THEME_BG = { light: '#f7f6f3', dark: '#161615' } as const;

function resolveBackgroundColor(): string {
  let preference: string | undefined;
  try {
    preference = (piReader.readSettings() as { theme?: string } | null)?.theme;
  } catch {
    /* settings unreadable — fall back to the system preference */
  }
  if (preference === 'light') return THEME_BG.light;
  if (preference === 'dark') return THEME_BG.dark;
  return nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light;
}

function createMainWindow() {
  // Size to the display instead of a fixed 1280x800: on a 2560x1440 desktop
  // that fixed box only covered a third of the screen. Take ~82% of the work
  // area, clamped so it stays reasonable on both small and very large screens.
  const { width: areaWidth, height: areaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1800, Math.max(1180, Math.round(areaWidth * 0.82)));
  const height = Math.min(1200, Math.max(760, Math.round(areaHeight * 0.86)));

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 640,
    center: true,
    title: 'pi-desktop',
    // Immersive top edge: no separate title strip, traffic lights float over
    // the sidebar (which reserves room for them via the .is-desktop class).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: resolveBackgroundColor(),
    icon: resolveAppIcon() ?? undefined,
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  // Surface renderer failures to the persistent log file.
  win.webContents.on('did-fail-load', (_e: unknown, code: number, desc: string, url: string) => {
    log(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e: unknown, details: { reason: string }) => {
    log('[render-process-gone]', details.reason);
  });
  win.webContents.on('did-finish-load', () => {
    log('[did-finish-load]', win.webContents.getURL());
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (apiServerUrl) {
    // Packaged mode: load the bundle from the local API server so the
    // frontend's fetch('/api/pi/*') calls resolve correctly.
    win.loadURL(apiServerUrl);
  } else {
    win.loadFile(resolveIndexHtml());
  }

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function createPopupWindow() {
  const trayBounds = tray?.getBounds();
  const x = trayBounds ? Math.round(trayBounds.x + trayBounds.width / 2 - 175) : undefined;
  const y = trayBounds ? trayBounds.y + trayBounds.height + 4 : undefined;

  const win = new BrowserWindow({
    width: 350,
    height: 500,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    movable: false,
    transparent: false,
    hasShadow: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load popup HTML (built alongside main web bundle into dist/)
  const popupDevUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}/electron/popup.html`
    : null;
  const popupFile = resolvePopupHtml();

  if (popupDevUrl) {
    win.loadURL(popupDevUrl);
  } else if (fs.existsSync(popupFile)) {
    win.loadFile(popupFile);
  } else {
    // Fallback: inject minimal HTML directly
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<html><body style="font-family:-apple-system;padding:16px;">Popup HTML not found.</body></html>'
    ));
  }

  win.on('blur', () => {
    // Hide shortly after blur to avoid flicker on click
    if (popupHideTimer) clearTimeout(popupHideTimer);
    popupHideTimer = setTimeout(() => {
      if (popupWindow && popupWindow.isVisible()) {
        popupWindow.hide();
      }
    }, 150);
  });

  win.on('closed', () => {
    popupWindow = null;
  });

  popupWindow = win;
  return win;
}

// ─── Tray ─────────────────────────────────────────────────

function createTray() {
  const t: TrayType = new Tray(createTrayIcon());
  tray = t;
  t.setToolTip('pi-desktop — 点击查看使用量');

  // Click on tray icon toggles the popup
  t.on('click', () => {
    togglePopup();
  });

  // Right-click (or click+hold) shows the context menu
  t.on('right-click', () => {
    showTrayMenu();
  });

  // On macOS, a secondary click also works
  t.on('mouse-down', (_e: any, bounds: any) => {
    void bounds;
  });
}

function showTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开 Dashboard', click: showMainWindow },
    { label: '刷新使用量', click: () => popupWindow?.webContents.reload() },
    { type: 'separator' },
    { label: '退出', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
  tray.popUpContextMenu(menu);
}

function togglePopup() {
  if (!popupWindow) {
    popupWindow = createPopupWindow();
  }
  const popup = popupWindow;
  if (!popup) return;
  if (popup.isVisible()) {
    popup.hide();
  } else {
    // Reposition under tray icon in case menu bar moved
    const t = tray;
    const trayBounds = t ? t.getBounds() : null;
    if (trayBounds) {
      const x = Math.round(trayBounds.x + trayBounds.width / 2 - 175);
      const y = trayBounds.y + trayBounds.height + 4;
      popup.setPosition(x, y);
    }
    popup.show();
    popup.focus();
  }
}

function showMainWindow() {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }
  const win = mainWindow;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ─── Menu ─────────────────────────────────────────────────

function createMenu() {
  const template: any = [
    {
      label: 'Application',
      submenu: [
        { label: 'About Application', selector: 'orderFrontStandardAboutPanel:' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC handlers (mirrors Vite dev server /api/pi/* routes) ──

// Full combined usage scan (pi + cindy + claude + codex + atomcode + copilot)
// reads ~150MB+ of session JSONL and can take ~10s cold. Cache the popup
// summary so clicking the tray icon is instant; refresh in the background.
// The popup's refresh button passes { force: true } to bypass the cache.
const SUMMARY_CACHE_TTL_MS = 25_000;
let summaryCache: { data: unknown; at: number } | null = null;

// pi-reader buckets dates in Asia/Shanghai (CN_TZ); the summary must use the
// SAME timezone or the "today" bucket slips by a day around midnight UTC.
function cnTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function computeUsageSummary() {
  const records = [
    ...piReader.readAllUsage(),
    ...piReader.readCindyUsage(),
    ...piReader.readClaudeUsage(),
    ...piReader.readCodexUsage(),
    ...piReader.readAtomcodeUsage(),
    ...piReader.readChatgptUsage(),
  ];
  const today = cnTodayStr();
  const now = new Date();
  const sevenDaysAgo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

  const todayRecords = records.filter((r) => r.date === today);
  const sevenDayRecords = records.filter((r) => r.date >= sevenDaysAgo);

  const sum = (recs: typeof records) => {
    let tokens = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    let cost = 0, requests = 0;
    for (const r of recs) {
      input += r.inputTokens;
      output += r.outputTokens;
      cacheRead += r.cacheReadTokens;
      cacheWrite += r.cacheWriteTokens;
      cost += r.cost;
      requests += r.requests;
    }
    tokens = input + output + cacheRead + cacheWrite;
    return { tokens, input, output, cacheRead, cacheWrite, cost, requests };
  };

  const todaySummary = sum(todayRecords);
  const sevenDaySummary = sum(sevenDayRecords);

  // Per-day breakdown for last 7 days (for mini sparkline)
  const dailyMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  for (const r of sevenDayRecords) {
    const d = dailyMap.get(r.date) ?? { tokens: 0, cost: 0, requests: 0 };
    d.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    d.cost += r.cost;
    d.requests += r.requests;
    dailyMap.set(r.date, d);
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top providers by cost (last 7 days)
  const providerMap = new Map<string, { providerId: string; cost: number; tokens: number; requests: number }>();
  for (const r of sevenDayRecords) {
    const p = providerMap.get(r.providerId) ?? { providerId: r.providerId, cost: 0, tokens: 0, requests: 0 };
    p.cost += r.cost;
    p.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    p.requests += r.requests;
    providerMap.set(r.providerId, p);
  }
  const providers = Array.from(providerMap.values()).sort((a, b) => b.cost - a.cost).slice(0, 5);

  return {
    today: todaySummary,
    sevenDays: sevenDaySummary,
    daily,
    providers,
    updatedAt: new Date().toISOString(),
  };
}

function setupIPC() {
  // Window chrome: renderer reports its resolved theme background so the
  // frameless title bar area never shows a stale (white) colour.
  ipcMain.handle('pi:window:background', (_e: IpcMainInvokeEvent, color: string) => {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return false;
    mainWindow?.setBackgroundColor(color);
    return true;
  });

  // Settings
  ipcMain.handle('pi:settings:get', () => piReader.readSettings());
  ipcMain.handle('pi:settings:set', (_e: IpcMainInvokeEvent, data: any) => piReader.writeSettings(data));
  // Auth
  ipcMain.handle('pi:auth:get', () => piReader.readAuth());

  // Open a directory in Finder (chat session panel). Validates that the
  // target exists and is a directory before handing it to the shell.
  ipcMain.handle('pi:open-in-finder', (_e: IpcMainInvokeEvent, target: unknown) => {
    if (typeof target !== 'string' || !target.trim()) return false;
    try {
      const resolved = path.resolve(target.trim());
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return false;
      shell.openPath(resolved);
      return true;
    } catch {
      return false;
    }
  });  ipcMain.handle('pi:auth:set', (_e: IpcMainInvokeEvent, data: any) => piReader.writeAuth(data));

  // Models
  ipcMain.handle('pi:models:get', () => piReader.readModels());
  ipcMain.handle('pi:models:set', (_e: IpcMainInvokeEvent, data: any) => piReader.writeModels(data));

  // Usage summary for the menu bar popup.
  // Returns today + 7d aggregated stats so the user can see usage at a glance.
  // opts.force bypasses the cache so the popup's refresh button actually works.
  ipcMain.handle('pi:usage:summary', (_e: IpcMainInvokeEvent, opts?: { force?: boolean }) => {
    try {
      if (!opts?.force && summaryCache && Date.now() - summaryCache.at < SUMMARY_CACHE_TTL_MS) {
        return summaryCache.data;
      }
      const data = computeUsageSummary();
      summaryCache = { data, at: Date.now() };
      return data;
    } catch (err) {
      return { error: String(err) };
    }
  });

  // Official Codex 5h / weekly quota for the menu bar popup. Uses the
  // locally logged-in openai-codex OAuth session; pi-reader returns only a
  // sanitized quota summary, never the OAuth tokens themselves.
  ipcMain.handle('pi:codex:usage', (_e: IpcMainInvokeEvent, opts?: { force?: boolean }) =>
    piReader.getCodexUsageStatus(opts?.force === true).catch((err: unknown) => ({
      loggedIn: false,
      provider: 'openai-codex' as const,
      checkedAt: new Date().toISOString(),
      error: String(err),
    }))
  );

  // Open external links (e.g. full Dashboard) from the popup
  ipcMain.handle('pi:open:dashboard', () => {
    showMainWindow();
  });

  ipcMain.handle('pi:open:external', (_e: IpcMainInvokeEvent, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  });
}

// Warm the summary cache in the background so the first tray click is instant.
function warmUsageCache() {
  setTimeout(() => {
    try {
      if (!summaryCache) {
        summaryCache = { data: computeUsageSummary(), at: Date.now() };
        console.log('[pi-desktop] usage summary warmed');
      }
    } catch (err) {
      console.error('[pi-desktop] warm usage failed:', err);
    }
  }, 1500);
}

// ─── Dock icon (dev only; packaged builds use icon.icns) ──

function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  // Packaged builds ship a proper icon.icns in Info.plist. Calling
  // app.dock.setIcon() here with a raw PNG made the running app's dock icon
  // render at a different size than the loading one (macOS normalises
  // Info.plist icons onto its icon grid, but not runtime-set PNGs).
  if (app.isPackaged) return;
  const iconPath = resolveAppIcon();
  if (iconPath && fs.existsSync(iconPath)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch {
      /* dock icon is cosmetic — ignore failures */
    }
  }
}

// ─── App lifecycle ───────────────────────────────────────

// Some macOS/GPU combinations (notably newer Electron on Intel Macs) fail to
// composite the window to screen while the renderer itself is healthy — the
// window stays white even though the page rendered (capturePage is fine).
// Software rendering fixes it and the UI is light enough not to need GPU.
app.disableHardwareAcceleration();

// Only one instance may run: a second one would start its own HTTP server and
// two processes would race on the same ~/.pi/agent config files. Focus the
// existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.whenReady().then(async () => {
  // The lock loser is already quitting; do not build a second tray/server.
  if (!app.hasSingleInstanceLock()) return;
  try {
    setDockIcon();
    createMenu();
    setupIPC();

    // Packaged mode: start the local HTTP server (bundle + /api/pi/* routes).
    // Dev mode keeps using the Vite dev server, so this only runs when
    // VITE_DEV_SERVER_URL is absent.
    if (!process.env.VITE_DEV_SERVER_URL) {
      const handle = await startApiServer();
      apiServerUrl = handle.url;
      console.log(`[pi-desktop] api server: ${handle.url}`);
    }

    // Menu-bar tray app: create tray + popup, and open the main Dashboard
    // window on launch so the app feels like a regular Mac application.
    // The window can be closed freely; the tray icon keeps running.
    createTray();
    createPopupWindow();
    showMainWindow();
    // Warm the usage summary cache in the background so the first tray click
    // shows data instantly instead of spinning ~10s while sessions scan.
    warmUsageCache();
    console.log('[pi-desktop] tray + popup ready');
  } catch (err) {
    console.error('[pi-desktop] startup failed:', err);
  }

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no window is open.
    if (BrowserWindow.getAllWindows().length === 0) {
      showMainWindow();
    }
  });
}).catch((err: unknown) => {
  console.error('[pi-desktop] whenReady rejected:', err);
});

app.on('window-all-closed', () => {
  // In menu-bar mode, keep the app running with just the tray icon.
  // (On macOS this is the default; on other platforms we also keep alive.)
  // Do NOT quit.
});

// Hide from Dock on macOS so it's purely a menu-bar app.
// Users can still Cmd+Q from the tray menu.
if (process.platform === 'darwin') {
  // LSUIElement in Info.plist handles this for packaged builds.
  // For dev, we can't fully hide from Dock, but the tray still works.
}

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('piAPI', {
  // Window chrome — keep the frameless title bar in sync with the UI theme
  setWindowBackground: (color: string) => ipcRenderer.invoke('pi:window:background', color),

  // Settings
  getSettings: () => ipcRenderer.invoke('pi:settings:get'),
  setSettings: (data: any) => ipcRenderer.invoke('pi:settings:set', data),

  // Auth
  getAuth: () => ipcRenderer.invoke('pi:auth:get'),
  setAuth: (data: any) => ipcRenderer.invoke('pi:auth:set', data),

  // Models
  getModels: () => ipcRenderer.invoke('pi:models:get'),
  setModels: (data: any) => ipcRenderer.invoke('pi:models:set', data),

  // Usage summary for the menu bar popup (today + 7d aggregated stats)
  getUsageSummary: (opts?: { force?: boolean }) => ipcRenderer.invoke('pi:usage:summary', opts),

  // Open the full Dashboard window from the popup
  openDashboard: () => ipcRenderer.invoke('pi:open:dashboard'),

  // Open an external http(s) URL in the system browser
  openExternal: (url: string) => ipcRenderer.invoke('pi:open:external', url),
});

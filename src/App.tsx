import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ChatPage } from "@/components/chat/ChatPage";

// Chat-only app. All configuration pages (dashboard, providers, sessions,
// memory, subagents, speed test, general settings) live inside the settings
// workspace at /settings.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsWorkspace />} />
          {/* Legacy basic-mode routes now land in the settings workspace. */}
          <Route path="/sessions" element={<Navigate to="/settings" replace />} />
          <Route path="/memory" element={<Navigate to="/settings" replace />} />
          <Route path="/providers" element={<Navigate to="/settings" replace />} />
          <Route path="/models" element={<Navigate to="/settings" replace />} />
          <Route path="/subagents" element={<Navigate to="/settings" replace />} />
          <Route path="/speed-test" element={<Navigate to="/settings" replace />} />
          <Route path="/dashboard" element={<Navigate to="/settings" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

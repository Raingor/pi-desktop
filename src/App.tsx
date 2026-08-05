import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { ChatPage } from "@/components/chat/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* Main view = chat (Cindy-style default) */}
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          {/* All other modules live inside Settings */}
          <Route path="/sessions" element={<Navigate to="/settings/sessions" replace />} />
          <Route path="/memory" element={<Navigate to="/settings/memory" replace />} />
          <Route path="/dashboard" element={<Navigate to="/settings/dashboard" replace />} />
          {/* Legacy redirects */}
          <Route path="/providers" element={<Navigate to="/settings/providers" replace />} />
          <Route path="/models" element={<Navigate to="/settings/models" replace />} />
          <Route path="/subagents" element={<Navigate to="/settings/subagents" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

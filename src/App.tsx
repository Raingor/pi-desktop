import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { ChatPage } from "@/components/chat/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<ChatPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          {/* Redirect old routes to settings */}
          <Route path="/providers" element={<Navigate to="/settings/providers" replace />} />
          <Route path="/models" element={<Navigate to="/settings/models" replace />} />
          <Route path="/subagents" element={<Navigate to="/settings/subagents" replace />} />
          <Route path="/chat" element={<Navigate to="/sessions" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

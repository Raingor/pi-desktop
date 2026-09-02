import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { ProvidersModelsPage } from "@/components/providers/ProvidersModelsPage";
import { SubagentsPage } from "@/components/subagents/SubagentsPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ModelSpeedTestPage } from "@/components/speedtest/ModelSpeedTestPage";
import { ChatPage } from "@/components/chat/ChatPage";
import { useUiMode } from "@/lib/ui-mode";

export default function App() {
  const { mode } = useUiMode();
  const chat = mode === "chat";

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* Chat mode opens on the conversation; basic mode on the dashboard. */}
          <Route path="/" element={chat ? <ChatPage /> : <DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/providers" element={<ProvidersModelsPage />} />
          <Route path="/models" element={<ProvidersModelsPage />} />
          <Route path="/subagents" element={<SubagentsPage />} />
          {/* Chat mode nests every config page inside the settings workspace. */}
          <Route
            path="/settings"
            element={chat ? <SettingsWorkspace /> : <SettingsPage />}
          />
          <Route path="/speed-test" element={<ModelSpeedTestPage />} />
          {/* Chat is unavailable in basic mode — fall back to the dashboard. */}
          <Route path="/chat" element={chat ? <ChatPage /> : <Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

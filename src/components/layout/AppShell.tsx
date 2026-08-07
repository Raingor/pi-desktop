import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CwdPickerModal } from "@/components/chat/CwdPickerModal";

export function AppShell() {
  const location = useLocation();
  // Chat is the main (full-height) view; settings is a regular page.
  const isChat = location.pathname.startsWith("/chat");

  return (
    <div className="relative flex h-screen overflow-hidden">
      {isChat && <Sidebar />}
      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--page-bg)" }}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
      <CwdPickerModal />
    </div>
  );
}

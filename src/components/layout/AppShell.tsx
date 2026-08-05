import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ContentHeader } from "./ContentHeader";
import { CwdPickerModal } from "@/components/chat/CwdPickerModal";

export function AppShell() {
  const location = useLocation();
  // Chat is the main (full-height) view; settings is a regular page.
  const isChat = location.pathname.startsWith("/chat");
  const isSettings = location.pathname.startsWith("/settings");

  return (
    <div className="relative flex h-screen overflow-hidden">
      {isChat && <Sidebar />}
      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--page-bg)" }}
      >
        {!isChat && !isSettings && <ContentHeader />}
        <div
          className={
            isChat
              ? "min-h-0 flex-1 overflow-hidden"
              : isSettings ? "w-full flex-1 overflow-y-auto px-8 py-6" : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          <Outlet />
        </div>
      </main>
      <CwdPickerModal />
    </div>
  );
}

import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ContentHeader } from "./ContentHeader";
import { CwdPickerModal } from "@/components/chat/CwdPickerModal";

export function AppShell() {
  const location = useLocation();
  // Chat is the main (full-height) view; settings is a regular page.
  const isChat = location.pathname.startsWith("/chat");

  return (
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar />
      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--page-bg)" }}
      >
        {!isChat && <ContentHeader />}
        <div
          className={
            isChat
              ? "min-h-0 flex-1 overflow-hidden"
              : "mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-8 py-6"
          }
        >
          <Outlet />
        </div>
      </main>
      <CwdPickerModal />
    </div>
  );
}

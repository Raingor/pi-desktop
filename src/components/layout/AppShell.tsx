import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const location = useLocation();
  const isFullHeightPage = location.pathname.startsWith("/chat");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main
        className={isFullHeightPage ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}
        style={{ backgroundColor: "var(--page-bg)" }}
      >
        {isFullHeightPage ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-7xl px-8 py-8">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}

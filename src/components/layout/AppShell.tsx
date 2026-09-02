import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, Terminal } from "lucide-react";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The chat and dashboard pages get the full canvas height.
  const isFullHeightPage =
    location.pathname === "/" || location.pathname.startsWith("/chat");

  return (
    <div className="app-shell">
      <div className="app-atmosphere" aria-hidden="true" />

      <Sidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {mobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="app-stage">
        <header className="mobile-command-bar">
          <button
            className="command-icon-button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="mobile-brand">
            <Terminal className="h-4 w-4" />
            <span>pi&nbsp;agent</span>
          </div>
          <span className="system-pulse" aria-hidden="true" />
        </header>

        <main className={isFullHeightPage ? "app-main app-main-full" : "app-main"}>
          {isFullHeightPage ? (
            <Outlet />
          ) : (
            <div className="app-canvas">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, RadioTower } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { BasicSidebar } from "./BasicSidebar";
import { HelpButton } from "@/components/help/HelpButton";
import { useUiMode } from "@/lib/ui-mode";

export function AppShell() {
  const location = useLocation();
  const { mode } = useUiMode();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Basic mode keeps every page inside the scrollable canvas, like the
  // pre-chat layout. Chat mode gives the chat and dashboard full height.
  const isFullHeightPage =
    mode === "chat" &&
    (location.pathname === "/" || location.pathname.startsWith("/chat"));

  return (
    <div className="app-shell">
      <div className="app-atmosphere" aria-hidden="true">
        <span className="app-orbit app-orbit-one" />
        <span className="app-orbit app-orbit-two" />
        <span className="app-scanline" />
      </div>

      {mode === "chat" ? (
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
      ) : (
        <BasicSidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
      )}

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
            <RadioTower className="h-4 w-4" />
            <span>PI // CONTROL</span>
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

      <HelpButton />
    </div>
  );
}

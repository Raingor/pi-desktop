import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, Terminal } from "lucide-react";
import { Sidebar } from "./Sidebar";

const SIDEBAR_WIDTH_KEY = "pi-web-switch:sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 264;

function loadSidebarWidth(): number {
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
}

export function AppShell() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const dragging = useRef(false);

  // The chat and dashboard pages get the full canvas height.
  const isFullHeightPage =
    location.pathname === "/" || location.pathname.startsWith("/chat");

  // ─── Sidebar resize ─────────────────────────────────
  // Pointer events on the splitter; widths are clamped and persisted. The
  // shell is scaled by --ui-zoom, so pointer coordinates divide back to
  // layout pixels before they become a width.
  const pointerXToWidth = useCallback((clientX: number) => {
    const zoom =
      Number(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--ui-zoom")
          .trim(),
      ) || 1;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(clientX / zoom)));
  }, []);

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
  };

  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setSidebarWidth(pointerXToWidth(event.clientX));
  };

  const onResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  };

  // The last pointermove's width is what should persist — keep the ref fresh.
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  useEffect(() => {
    // Persist on unmount too (covers edge cases like navigation mid-drag).
    const flush = () =>
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className="app-shell" style={{ ["--sidebar-w" as string]: `${sidebarWidth}px` }}>
      <div className="app-atmosphere" aria-hidden="true" />

      <Sidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整项目对话列表宽度"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => {
          setSidebarWidth(SIDEBAR_DEFAULT);
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT));
        }}
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

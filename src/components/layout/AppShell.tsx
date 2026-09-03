import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, PanelRight, Terminal } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { RightPanel, TOOL_TABS, type ToolTab } from "./RightPanel";
import { WorkspaceProvider } from "@/lib/workspace";

const SIDEBAR_WIDTH_KEY = "pi-web-switch:sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 264;

const TOOLS_OPEN_KEY = "pi-desktop:tools-open";
const TOOLS_TAB_KEY = "pi-desktop:tools-tab";
const TOOLS_WIDTH_KEY = "pi-desktop:tools-width";
const TOOLS_MIN = 280;
const TOOLS_MAX = 720;
const TOOLS_DEFAULT = 380;

function loadSidebarWidth(): number {
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT;
}

function loadToolsWidth(): number {
  const saved = Number(window.localStorage.getItem(TOOLS_WIDTH_KEY));
  return saved >= TOOLS_MIN && saved <= TOOLS_MAX ? saved : TOOLS_DEFAULT;
}

function loadToolsTab(): ToolTab {
  const saved = window.localStorage.getItem(TOOLS_TAB_KEY);
  return TOOL_TABS.some((t) => t.key === saved) ? (saved as ToolTab) : "files";
}

/** Layout pixels per CSS pixel — the shell is scaled by --ui-zoom. */
function currentZoom(): number {
  return (
    Number(
      getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom").trim(),
    ) || 1
  );
}

export function AppShell() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const dragging = useRef(false);

  // ─── Tool panel ─────────────────────────────────────
  // Hidden until asked for; state survives reloads.
  const [toolsOpen, setToolsOpen] = useState(
    () => window.localStorage.getItem(TOOLS_OPEN_KEY) === "1",
  );
  const [toolsTab, setToolsTab] = useState<ToolTab>(loadToolsTab);
  const [toolsWidth, setToolsWidth] = useState(loadToolsWidth);
  const draggingTools = useRef(false);

  // The chat and dashboard pages get the full canvas height.
  const isFullHeightPage =
    location.pathname === "/" || location.pathname.startsWith("/chat");

  const toggleTools = useCallback(() => {
    setToolsOpen((open) => {
      window.localStorage.setItem(TOOLS_OPEN_KEY, open ? "0" : "1");
      return !open;
    });
  }, []);

  const selectToolsTab = useCallback((tab: ToolTab) => {
    setToolsTab(tab);
    window.localStorage.setItem(TOOLS_TAB_KEY, tab);
  }, []);

  // Cmd/Ctrl+J mirrors the toggle button, matching editor conventions.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleTools();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTools]);

  // ─── Sidebar resize ─────────────────────────────────
  // Pointer events on the splitter; widths are clamped and persisted. The
  // shell is scaled by --ui-zoom, so pointer coordinates divide back to
  // layout pixels before they become a width.
  const pointerXToWidth = useCallback((clientX: number) => {
    return Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, Math.round(clientX / currentZoom())),
    );
  }, []);

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
  };

  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const next = pointerXToWidth(event.clientX);
    widthRef.current = next;
    setSidebarWidth(next);
  };

  const onResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
  };

  // ─── Tool panel resize ──────────────────────────────
  // Mirror image of the sidebar splitter: the panel is right-anchored, so its
  // width grows as the pointer moves left of the viewport edge.
  const onToolsResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingTools.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
  };

  const onToolsResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingTools.current) return;
    const zoom = currentZoom();
    const viewport = window.innerWidth / zoom;
    const next = Math.min(
      TOOLS_MAX,
      Math.max(TOOLS_MIN, Math.round(viewport - event.clientX / zoom)),
    );
    toolsWidthRef.current = next;
    setToolsWidth(next);
  };

  const onToolsResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingTools.current) return;
    draggingTools.current = false;
    event.currentTarget.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    window.localStorage.setItem(TOOLS_WIDTH_KEY, String(toolsWidthRef.current));
  };

  // The last pointermove's width is what should persist. Keep the refs updated
  // from the move handlers rather than during render: a pointerdown/move/up
  // sequence that lands in one React batch never re-renders in between, so a
  // handler closure would still hold the pre-drag width.
  const widthRef = useRef(sidebarWidth);
  const toolsWidthRef = useRef(toolsWidth);

  useEffect(() => {
    // Persist on unmount too (covers edge cases like navigation mid-drag).
    const flush = () => {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
      window.localStorage.setItem(TOOLS_WIDTH_KEY, String(toolsWidthRef.current));
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <WorkspaceProvider>
      <div
        className={`app-shell${toolsOpen ? " has-tools" : ""}`}
        style={{
          ["--sidebar-w" as string]: `${sidebarWidth}px`,
          ["--tools-w" as string]: `${toolsWidth}px`,
        }}
      >
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
            widthRef.current = SIDEBAR_DEFAULT;
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

          {/* Floats over the page's own top edge so no page needs to host it. */}
          <button
            className={`tools-toggle${toolsOpen ? " is-active" : ""}`}
            onClick={toggleTools}
            title={`${toolsOpen ? "隐藏" : "显示"}工具面板 (⌘J)`}
            aria-label={`${toolsOpen ? "隐藏" : "显示"}工具面板`}
            aria-pressed={toolsOpen}
          >
            <PanelRight className="h-4 w-4" />
          </button>

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

        {toolsOpen && (
          <>
            <div
              className="tools-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整工具面板宽度"
              onPointerDown={onToolsResizeStart}
              onPointerMove={onToolsResizeMove}
              onPointerUp={onToolsResizeEnd}
              onPointerCancel={onToolsResizeEnd}
              onDoubleClick={() => {
                setToolsWidth(TOOLS_DEFAULT);
                toolsWidthRef.current = TOOLS_DEFAULT;
                window.localStorage.setItem(TOOLS_WIDTH_KEY, String(TOOLS_DEFAULT));
              }}
            />
            <RightPanel
              tab={toolsTab}
              onTabChange={selectToolsTab}
              onClose={toggleTools}
            />
          </>
        )}
      </div>
    </WorkspaceProvider>
  );
}

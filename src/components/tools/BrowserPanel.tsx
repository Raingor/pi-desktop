// Browser panel — an embedded browser for docs, localhost previews and API
// consoles without leaving the app.
//
// Uses Electron's <webview>, not an iframe: most sites send X-Frame-Options or
// frame-ancestors and would render blank in an iframe. In the browser-only dev
// server there is no webview tag, so the panel degrades to a launcher that
// hands the URL to the system browser.

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  RotateCw,
} from "lucide-react";

const HOME_KEY = "pi-desktop:browser-url";

/** Accept "example.com", "localhost:3000" and full URLs alike. */
function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(text)) {
    return `http://${text}`;
  }
  if (/^[\w-]+(\.[\w-]+)+/.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/** Minimal shape of the parts of <webview> this panel drives. */
interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

export function BrowserPanel() {
  const hasWebview = typeof window !== "undefined" && !!window.piAPI;

  const [address, setAddress] = useState(
    () => window.localStorage.getItem(HOME_KEY) ?? "",
  );
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(false);
  const viewRef = useRef<WebviewElement | null>(null);

  // Wire load state and address sync to the webview's own events.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const start = () => setLoading(true);
    const stop = () => {
      setLoading(false);
      try {
        const url = view.getURL();
        if (url && url !== "about:blank") {
          setCurrent(url);
          setAddress(url);
        }
      } catch {
        /* webview not ready */
      }
    };
    view.addEventListener("did-start-loading", start);
    view.addEventListener("did-stop-loading", stop);
    return () => {
      view.removeEventListener("did-start-loading", start);
      view.removeEventListener("did-stop-loading", stop);
    };
  }, [current]);

  const go = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    window.localStorage.setItem(HOME_KEY, url);
    setAddress(url);
    if (!hasWebview) {
      window.piAPI?.openExternal?.(url);
      return;
    }
    // Setting `current` is what mounts the <webview> in the first place, so it
    // must not be gated on the ref existing. Once mounted, assigning src also
    // drives navigation when `current` is unchanged — the case where the user
    // followed links inside the page and then re-entered the original address.
    setCurrent(url);
    if (viewRef.current) viewRef.current.src = url;
  };

  const nav = (action: "back" | "forward" | "reload") => {
    const view = viewRef.current;
    if (!view) return;
    try {
      if (action === "back" && view.canGoBack()) view.goBack();
      else if (action === "forward" && view.canGoForward()) view.goForward();
      else if (action === "reload") view.reload();
    } catch {
      /* nothing loaded yet */
    }
  };

  return (
    <div className="tool-panel-body">
      <div className="tool-panel-bar">
        <button className="tool-icon-btn" aria-label="后退" onClick={() => nav("back")}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button className="tool-icon-btn" aria-label="前进" onClick={() => nav("forward")}>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button className="tool-icon-btn" aria-label="重新加载" onClick={() => nav("reload")}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCw className="h-3.5 w-3.5" />
          )}
        </button>
        <input
          className="tool-browser-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              go(address);
            }
          }}
          placeholder="localhost:5179 或 pi.dev"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="tool-icon-btn"
          aria-label="用系统浏览器打开"
          title="用系统浏览器打开"
          onClick={() => current && window.piAPI?.openExternal?.(current)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {!hasWebview ? (
        <div className="tool-panel-empty">
          浏览器面板需要桌面应用环境。{"\n"}
          在开发服务器里请用上方地址栏调用系统浏览器打开。
        </div>
      ) : !current ? (
        <div className="tool-panel-empty">
          <Globe className="h-5 w-5" />
          输入地址开始浏览
          <div className="tool-browser-shortcuts">
            {["localhost:5179", "pi.dev", "github.com"].map((shortcut) => (
              <button key={shortcut} onClick={() => go(shortcut)}>
                {shortcut}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // partition keeps cookies for this panel separate from the app itself
        <webview
          ref={viewRef as unknown as React.Ref<HTMLElement>}
          src={current}
          partition="persist:pi-desktop-browser"
          className="tool-browser-view"
        />
      )}
    </div>
  );
}

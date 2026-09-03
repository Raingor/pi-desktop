import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useConfigStore } from "@/store/config-store";
import { I18nProvider } from "@/lib/i18n";
import { UiModeProvider } from "@/lib/ui-mode";
import { useTranslation } from "@/lib/i18n";
import translations from "@/lib/translations";
import App from "@/App";
import "@/index.css";

// ─── Theme Sync ─────────────────────────────────────────
/**
 * Push the resolved page background to the Electron window so the frameless
 * title-bar strip matches the theme instead of flashing white.
 */
/**
 * Mark the document when running inside the Electron shell so CSS can reserve
 * room for the floating traffic lights and make the top strip draggable.
 */
function markDesktopShell() {
  if ((window as unknown as { piAPI?: unknown }).piAPI) {
    document.documentElement.classList.add("is-desktop-shell");
  }
}
markDesktopShell();

function syncWindowChrome() {
  const api = (window as unknown as { piAPI?: { setWindowBackground?: (color: string) => void } }).piAPI;
  if (!api?.setWindowBackground) return;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--page-bg").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) api.setWindowBackground(value);
}

function useThemeSync(initialized: boolean) {
  const theme = useConfigStore((s) => s.settings?.theme);

  useEffect(() => {
    if (!initialized) return;
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      root.classList.remove("dark", "light");
      if (theme === "dark") {
        root.classList.add("dark");
      } else if (theme === "light") {
        root.classList.add("light");
      } else {
        root.classList.add(mediaQuery.matches ? "dark" : "light");
      }
      syncWindowChrome();
    }
    applyTheme();

    if (theme !== "light" && theme !== "dark") {
      const handler = () => applyTheme();
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [initialized, theme]);
}

function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="loading-console">
      <div className="loading-core">
        <div className="loading-ring" />
        <p>{t("loading.config")}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="loading-console">
      <div className="tech-panel relative z-10 flex max-w-md flex-col items-center gap-4 rounded-xl border p-8 text-center">
        <p className="text-lg font-semibold text-red-400">{t("loading.error_title")}</p>
        <p className="text-sm text-gray-400">{error}</p>
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
        >
          {t("loading.retry")}
        </button>
      </div>
    </div>
  );
}

function InitGate({ children }: { children: React.ReactNode }) {
  const initialized = useConfigStore((s) => s.initialized);
  const loading = useConfigStore((s) => s.loading);
  const error = useConfigStore((s) => s.error);
  const init = useConfigStore((s) => s.init);

  useThemeSync(initialized);

  useEffect(() => {
    init();
  }, [init]);

  if (!initialized || loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorScreen error={error} onRetry={init} />;
  }

  return <>{children}</>;
}

function Root() {
  return (
    <I18nProvider translations={translations}>
      <UiModeProvider>
        <InitGate>
          <App />
        </InitGate>
      </UiModeProvider>
    </I18nProvider>
  );
}

// ─── UI font size: apply saved value before first paint ─
applySavedFontSize();
function applySavedFontSize() {
  const saved = Number(localStorage.getItem("pi-font-size"));
  if (saved >= 12 && saved <= 24) {
    document.documentElement.style.fontSize = `${saved}px`;
  }
}

// ─── UI zoom: apply saved percentage before first paint ─
applySavedUiStyle();
applySavedZoom();
function applySavedUiStyle() {
  const style = window.localStorage.getItem("pi-ui-style");
  const known = ["graphite","terminal","cyber","pixel","kawaii","elegant","plain","amber","violet","vscode","kiro","claude","codex","gemini","grok"];
  if (style && known.includes(style)) {
    document.documentElement.dataset.style = style;
  }
}

function applySavedZoom() {
  const saved = Number(localStorage.getItem("pi-ui-zoom"));
  document.documentElement.style.zoom = "";
  if (saved >= 50 && saved <= 200) {
    document.documentElement.style.setProperty("--ui-zoom", String(saved / 100));
  }
}

// ─── Service worker lifecycle ───────────────────────────
// A production SW can remain registered when the same localhost origin is
// later opened with Vite dev. Actively remove it in development; otherwise a
// normal Cmd+R may be served an old HTML shell while Cmd+Shift+R bypasses it.
const APP_CACHE_PREFIX = "pi-web-switch-";
const DEV_SW_CLEANUP_KEY = "pi-web-switch-dev-sw-cleaned";

async function clearAppCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(APP_CACHE_PREFIX)).map((key) => caches.delete(key))
  );
}

function getAppBaseUrl() {
  const moduleScript = Array.from(document.scripts).find(
    (script) => script.type === "module" && script.src
  );
  return new URL("../", moduleScript?.src ?? document.baseURI);
}

async function configureServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const appBaseUrl = getAppBaseUrl();

  if (import.meta.env.DEV) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const appRegistrations = registrations.filter(
        (registration) => registration.scope === appBaseUrl.href
      );
      const hadController = Boolean(navigator.serviceWorker.controller);
      const removed = await Promise.all(
        appRegistrations.map((registration) => registration.unregister())
      );
      await clearAppCaches();

      // If this document was already controlled by the old production worker,
      // reload once after unregistering it so the first API/static requests are
      // also guaranteed to bypass the old worker. sessionStorage prevents a
      // reload loop if the browser reports the controller for one extra tick.
      if (
        hadController &&
        removed.some(Boolean) &&
        sessionStorage.getItem(DEV_SW_CLEANUP_KEY) !== "1"
      ) {
        sessionStorage.setItem(DEV_SW_CLEANUP_KEY, "1");
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(DEV_SW_CLEANUP_KEY);
    } catch (err) {
      // Cache cleanup must never prevent React from mounting.
      console.warn("SW cleanup failed:", err);
    }
    return;
  }

  try {
    // Resolve from the built JS asset directory so this also works when the
    // app is hosted under a subdirectory instead of the domain root.
    const swUrl = new URL("sw.js", appBaseUrl);
    const registration = await navigator.serviceWorker.register(swUrl, {
      updateViaCache: "none",
    });
    // Check on every application start instead of waiting for the browser's
    // periodic service-worker update window.
    await registration.update();
  } catch (err) {
    console.warn("SW registration failed:", err);
  }
}

async function bootstrap() {
  if (import.meta.env.DEV) {
    await configureServiceWorker();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  );

  if (import.meta.env.PROD) {
    void configureServiceWorker();
  }
}

void bootstrap();
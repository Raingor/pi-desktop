import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { useConfigStore } from "@/store/config-store";
import { I18nProvider } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n";
import translations from "@/lib/translations";
import App from "@/App";
import "@/index.css";

// ─── Theme Sync ─────────────────────────────────────────
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
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        <p className="text-sm text-gray-500">{t("loading.config")}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
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
      <InitGate>
        <App />
      </InitGate>
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
applySavedZoom();
function applySavedZoom() {
  const saved = Number(localStorage.getItem("pi-ui-zoom"));
  if (saved >= 50 && saved <= 200) {
    document.documentElement.style.zoom = `${saved}%`;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);

// ─── File watcher: auto-refresh on pi config changes ────
// Listen for Rust file watcher events and refresh the store
if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
  listen("pi-files-changed", () => {
    useConfigStore.getState().init();
  }).catch(() => {
    // Tauri context not available (e.g., during SSR)
  });
}
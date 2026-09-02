import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * UI mode: "chat" is the conversational shell, "basic" is the original
 * dashboard-first layout that existed before the chat workspace was added.
 */
export type UiMode = "chat" | "basic";

const STORAGE_KEY = "pi-web-switch:ui-mode";

interface UiModeValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

const UiModeContext = createContext<UiModeValue>({
  mode: "chat",
  setMode: () => {},
});

function readStoredMode(): UiMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "basic"
      ? "basic"
      : "chat";
  } catch {
    return "chat";
  }
}

export function UiModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<UiMode>(readStoredMode);

  // Keep other tabs/windows of the same app in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setModeState(readStoredMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((next: UiMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / quota — in-memory switch still applies */
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
  );
}

export function useUiMode() {
  return useContext(UiModeContext);
}

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

/**
 * UI mode. The app is chat-only now; this context is kept for the components
 * that still read it, and always reports "chat".
 */
export type UiMode = "chat" | "basic";

const UiModeContext = createContext<{ mode: UiMode; setMode: (mode: UiMode) => void }>({
  mode: "chat",
  setMode: () => {},
});

export function UiModeProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ mode: "chat" as const, setMode: () => {} }), []);
  return (
    <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
  );
}

export function useUiMode() {
  return useContext(UiModeContext);
}

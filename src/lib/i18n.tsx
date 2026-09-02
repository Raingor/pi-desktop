// ─── Multi-language Translation System ──────────────────
// Uses React Context + hook, zero external dependencies.

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type LangCode = "en" | "zh-CN" | "zh-TW" | "ja";

export const LANGUAGES: { code: LangCode; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
  { code: "zh-TW", label: "繁體中文", nativeLabel: "繁體中文" },
  { code: "ja", label: "日本語", nativeLabel: "日本語" },
];

// ─── Translation Map ────────────────────────────────────

type TranslationMap = Record<string, string | ((...args: string[]) => string)>;
export type Translations = Record<LangCode, TranslationMap>;

// ─── Context ────────────────────────────────────────────

interface I18nContextValue {
  lang: LangCode;
  setLang: (code: LangCode) => void;
  t: (key: string, ...args: string[]) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "pi-web-switch-lang";

function loadLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && ["en", "zh-CN", "zh-TW", "ja"].includes(saved)) return saved as LangCode;
  } catch {}
  // Detect browser language
  try {
    const browserLang = navigator.language;
    if (browserLang.startsWith("zh")) {
      if (browserLang === "zh-TW" || browserLang === "zh-HK") return "zh-TW";
      return "zh-CN";
    }
    if (browserLang.startsWith("ja")) return "ja";
  } catch {}
  return "en";
}

export function I18nProvider({
  children,
  translations,
}: {
  children: ReactNode;
  translations: Translations;
}) {
  const [lang, setLangState] = useState<LangCode>(loadLang);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch {}
  }, []);

  const t = useCallback(
    (key: string, ...args: string[]): string => {
      const map = translations[lang];
      let val = map?.[key];
      if (val === undefined) {
        // Fallback to English
        val = translations["en"]?.[key];
      }
      if (val === undefined) return key;
      if (typeof val === "function") return val(...args);
      // Replace {0}, {1}, ... placeholders with actual arguments
      if (args.length > 0) {
        let result: string = val;
        for (let i = 0; i < args.length; i++) {
          const arg = args[i] ?? "";
          result = result.replace(new RegExp(`\\{${i}\\}`, "g"), arg);
        }
        return result;
      }
      return val;
    },
    [lang, translations]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within I18nProvider");
  return ctx;
}

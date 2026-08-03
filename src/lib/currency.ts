// ─── Currency Switching ────────────────────────────────
// Simple state management for USD/CNY toggle, persisted in localStorage.

import { useState, useCallback } from "react";

export type CurrencyCode = "USD" | "CNY";

const STORAGE_KEY = "pi-web-switch-currency";

function loadCurrency(): CurrencyCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "USD" || saved === "CNY") return saved;
  } catch {}
  return "USD";
}

let _currency: CurrencyCode = loadCurrency();
let _listeners: Array<(c: CurrencyCode) => void> = [];

export function getCurrency(): CurrencyCode {
  return _currency;
}

export function setCurrency(code: CurrencyCode): void {
  _currency = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch {}
  _listeners.forEach((fn) => fn(code));
}

export function useCurrency() {
  const [currency, setCur] = useState<CurrencyCode>(_currency);

  const toggle = useCallback(() => {
    const next: CurrencyCode = currency === "USD" ? "CNY" : "USD";
    setCurrency(next);
    setCur(next);
  }, [currency]);

  // Subscribe to external changes
  useState(() => {
    const handler = (c: CurrencyCode) => setCur(c);
    _listeners.push(handler);
    return () => { _listeners = _listeners.filter((fn) => fn !== handler); };
  });

  return { currency, toggle, setCurrency: setCur };
}

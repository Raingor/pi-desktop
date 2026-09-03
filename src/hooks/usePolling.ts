import { useEffect, useRef } from "react";

/**
 * Run `task` immediately, then every `intervalMs` — but only while the window
 * is visible.
 *
 * This app lives in the menu bar, so its window spends most of its life hidden
 * rather than closed. Plain setInterval polling kept the sidebar, task list and
 * subagent panel hitting the API every 2–4 seconds behind a window nobody was
 * looking at, and each of those requests re-reads session files or spawns git.
 * Chromium also throttles background timers to roughly once a minute, so the
 * polls that did fire arrived at unpredictable intervals — which is worse than
 * not polling at all.
 *
 * Becoming visible runs `task` right away, so the first thing a returning user
 * sees is current data rather than whatever was on screen when they left.
 *
 * `task` is read through a ref, so an inline arrow function does not restart
 * the interval on every render. `intervalMs <= 0` disables polling while
 * keeping the initial run.
 */
export function usePolling(task: () => void, intervalMs: number, enabled = true): void {
  const taskRef = useRef(task);
  // Keep the ref current without making it an effect dependency.
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    const run = () => taskRef.current();

    const start = () => {
      if (timer !== undefined) return;
      run();
      if (intervalMs > 0) timer = window.setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [intervalMs, enabled]);
}

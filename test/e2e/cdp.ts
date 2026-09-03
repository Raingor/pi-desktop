// Minimal Chrome DevTools Protocol client.
//
// No puppeteer: the packaged app is already running and already serves its
// renderer over HTTP, so all this needs is a WebSocket and three commands.
// Adding a browser automation framework to drive a page that is not a browser
// tab would mean shipping a second Chromium to talk to the first one.
//
// The console / exception / failed-request subscriptions are the reason this is
// worth writing at all. A page that renders but logs a TypeError, or whose data
// request 404s, looks identical to a healthy page in a screenshot — and looked
// identical to a passing assertion before these were collected.

import { setTimeout as delay } from "node:timers/promises";

export interface Target {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface PageProblem {
  kind: "console" | "exception" | "request";
  text: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class CdpSession {
  private socket!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  readonly problems: PageProblem[] = [];

  readonly target: Target;

  // A plain assignment, not a parameter property: Node's strip-only TypeScript
  // mode cannot erase those, and this file is executed directly.
  private constructor(target: Target) {
    this.target = target;
  }

  /** List the debuggable targets, waiting for the endpoint to come up. */
  static async targets(port: number, timeoutMs = 30_000): Promise<Target[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const attempt = await CdpSession.fetchTargets(port);
      if (Array.isArray(attempt)) return attempt;
      if (Date.now() >= deadline) {
        throw new Error(`CDP endpoint not ready on ${port}: ${attempt.error}`);
      }
      await delay(300);
    }
  }

  /**
   * One list attempt: the targets, or why they could not be read. Returning the
   * reason instead of stashing it in a mutable outer variable is what makes the
   * "not ready" message provably the last thing that actually happened.
   */
  private static async fetchTargets(port: number): Promise<Target[] | { error: string }> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) return (await res.json()) as Target[];
      return { error: `status ${res.status}` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Attach to a target and start collecting page problems. */
  static async attach(target: Target): Promise<CdpSession> {
    if (!target.webSocketDebuggerUrl) throw new Error(`target has no debugger URL: ${target.url}`);
    const session = new CdpSession(target);
    session.socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      session.socket.addEventListener("open", () => resolve(), { once: true });
      session.socket.addEventListener("error", () => reject(new Error(`cannot connect to ${target.url}`)), { once: true });
    });
    session.socket.addEventListener("message", (event) => session.onMessage(String(event.data)));

    await session.call("Runtime.enable");
    await session.call("Log.enable");
    await session.call("Network.enable");
    return session;
  }

  private onMessage(raw: string) {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP error"));
      else pending.resolve(message.result);
      return;
    }
    switch (message.method) {
      case "Runtime.consoleAPICalled": {
        if (message.params?.type !== "error") break;
        const text = (message.params.args ?? [])
          .map((a: any) => a?.value ?? a?.description ?? a?.type)
          .join(" ");
        this.problems.push({ kind: "console", text });
        break;
      }
      case "Runtime.exceptionThrown": {
        const details = message.params?.exceptionDetails;
        this.problems.push({
          kind: "exception",
          text: details?.exception?.description ?? details?.text ?? "unknown exception",
        });
        break;
      }
      case "Log.entryAdded": {
        const entry = message.params?.entry;
        if (entry?.level === "error") {
          this.problems.push({ kind: "console", text: `${entry.source}: ${entry.text}` });
        }
        break;
      }
      case "Network.loadingFailed": {
        // Cancellations are normal: the chat page aborts in-flight history
        // requests when the session changes.
        if (message.params?.canceled) break;
        this.problems.push({
          kind: "request",
          text: `${message.params?.type ?? "request"} failed: ${message.params?.errorText ?? "?"}`,
        });
        break;
      }
    }
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
    });
  }

  /**
   * Evaluate an expression in the page and return its value.
   *
   * Promises are awaited, so a caller can evaluate an async expression and get
   * the settled value. A thrown exception becomes a rejection here rather than
   * an undefined result, which would otherwise read as a benign empty value.
   */
  async eval<T = unknown>(expression: string): Promise<T> {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? "evaluation failed";
      throw new Error(detail);
    }
    return result.result?.value as T;
  }

  /** Problems collected since the last call, then cleared. */
  drainProblems(): PageProblem[] {
    return this.problems.splice(0, this.problems.length);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

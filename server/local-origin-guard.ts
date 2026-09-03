// Local-origin guard for the Pi API.
//
// Binding to 127.0.0.1 on a random port keeps this API off the network, but it
// does NOT stop a web page you happen to visit from firing requests at it: a
// "simple" cross-site POST (text/plain body) arrives with no preflight, and
// although the attacker cannot read the reply, the side effects still happen —
// trashing sessions, overwriting models.json, starting a pi run. So reject
// anything that identifies itself as coming from another site.

export interface GuardableRequest {
  method?: string;
  headers: {
    host?: string;
    origin?: string;
    "content-type"?: string;
    [key: string]: string | string[] | undefined;
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Returns a rejection reason, or null when the request may proceed. */
export function rejectNonLocalRequest(req: GuardableRequest): string | null {
  // DNS rebinding: a hostile domain re-resolved to 127.0.0.1 still sends its
  // own name in Host, so only loopback names are accepted.
  const host = req.headers.host;
  if (typeof host === "string" && host && !LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ""))) {
    return "unexpected Host header";
  }
  // A missing Origin means a non-browser client (the Electron main process,
  // curl). Browsers always send it cross-site, which is the case guarded here;
  // "null" is a browser reporting an opaque origin, so it is not trusted.
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin && !isLoopbackOrigin(origin)) {
    return "cross-origin request rejected";
  }
  // Belt and braces: a cross-site POST cannot declare a JSON body without
  // triggering a preflight, and this server answers no preflights. Bodyless
  // POSTs send no Content-Type at all, so only a wrong one is rejected.
  if (req.method === "POST") {
    const contentType = req.headers["content-type"];
    if (
      typeof contentType === "string" &&
      contentType &&
      !contentType.toLowerCase().startsWith("application/json")
    ) {
      return "POST body must be application/json";
    }
  }
  return null;
}

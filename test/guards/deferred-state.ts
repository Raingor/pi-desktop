// Static guard: a React state updater must never read `event.currentTarget`.
//
// React assigns `currentTarget` while the synthetic event propagates and resets
// it to `null` once dispatch finishes — one event object visits several
// handlers, so the field is only meaningful during the call. That is unrelated
// to the event pooling React 17 removed, and it still applies in React 19.
//
// A `setState(updater)` closure is not part of that call. React runs it when the
// queue is processed, which is a later tick whenever an update is already
// pending. It *looks* synchronous while the fiber is idle, because React then
// evaluates the updater eagerly to compare states — so this mistake passes every
// manual test and only fires under load:
//
//   onToggle={(e) => setOpen((prev) => ({ ...prev, [i]: e.currentTarget.open }))}
//
// That exact line took the chat page down mid-answer with "Cannot read
// properties of null (reading 'open')": every run step renders `<details open>`,
// Chromium fires `toggle` on mount, and the streamed deltas guarantee a pending
// update. The fix is to read the field in the handler and close over the value.
//
// `event.target` is deliberately not covered: it holds a real DOM node that
// React leaves alone, so reading it later is safe.

export interface DeferredEventRead {
  /** 1-based line of the offending setter call. */
  line: number;
  snippet: string;
}

/**
 * Blank out string bodies and comments, preserving length and newlines.
 *
 * Same-length output is what lets the caller keep using indices from the
 * original text, so a reported line number always points at real code. Template
 * literals keep their `${…}` expressions — a read hidden in an interpolation is
 * still a read.
 */
export function maskLiterals(source: string): string {
  const out = source.split("");
  const blank = (i: number) => {
    if (out[i] !== "\n") out[i] = " ";
  };
  // A stack, because `${…}` puts code back inside a template literal, and that
  // code may open another template.
  const stack: { mode: "code" | "template"; braces: number }[] = [
    { mode: "code", braces: 0 },
  ];
  let i = 0;
  while (i < source.length) {
    const frame = stack[stack.length - 1]!;
    const c = source[i]!;

    if (frame.mode === "template") {
      if (c === "\\") {
        blank(i);
        blank(i + 1);
        i += 2;
      } else if (c === "`") {
        blank(i);
        i += 1;
        stack.pop();
      } else if (c === "$" && source[i + 1] === "{") {
        i += 2; // `${` stays visible so the expression reads as code
        stack.push({ mode: "code", braces: 0 });
      } else {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      blank(i);
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") {
          blank(i);
          blank(i + 1);
          i += 2;
          continue;
        }
        blank(i);
        i += 1;
      }
      if (i < source.length) {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (c === "`") {
      blank(i);
      i += 1;
      stack.push({ mode: "template", braces: 0 });
      continue;
    }

    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        blank(i);
        i += 1;
      }
      continue;
    }

    if (c === "/" && source[i + 1] === "*") {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        blank(i);
        i += 1;
      }
      if (i < source.length) {
        blank(i);
        blank(i + 1);
        i += 2;
      }
      continue;
    }

    if (c === "{") {
      frame.braces += 1;
    } else if (c === "}") {
      // The brace that closes a `${…}` is the one with nothing left to match.
      if (frame.braces === 0 && stack.length > 1) {
        stack.pop();
        i += 1;
        continue;
      }
      frame.braces -= 1;
    }
    i += 1;
  }
  return out.join("");
}

/** Text between `(` at `open` and its match, or null if it never closes. */
function callArguments(masked: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return masked.slice(open + 1, i);
    }
  }
  return null;
}

const SETTER = /\bset[A-Z][A-Za-z0-9_]*\(/g;

/**
 * Report every `setX(…)` whose argument is a callback that mentions
 * `currentTarget`.
 *
 * The `=>` requirement is what separates a defect from the safe spelling:
 * `setZoom(Number(e.currentTarget.value))` computes the value inside the
 * handler, which is fine, whereas an arrow defers the read.
 */
export function findDeferredEventReads(source: string): DeferredEventRead[] {
  const masked = maskLiterals(source);
  const found: DeferredEventRead[] = [];
  for (const match of masked.matchAll(SETTER)) {
    const open = match.index + match[0].length - 1;
    const args = callArguments(masked, open);
    if (args === null) continue;
    if (!args.includes("=>")) continue;
    if (!args.includes("currentTarget")) continue;
    const line = masked.slice(0, open).split("\n").length;
    // Report from the original text so the snippet is readable.
    const raw = source.slice(match.index, match.index + match[0].length + args.length + 1);
    found.push({ line, snippet: raw.replace(/\s+/g, " ").slice(0, 120) });
  }
  return found;
}

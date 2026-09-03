// Element location for the UI walk, as pure functions.
//
// This file exists because of a specific false pass. The tool panel's tabs are
// icon-only buttons, so `textContent` is the empty string, and the driver's
// matcher was `textContent.includes(query)` — which is *always true* for an
// empty query and, worse, true for the first node whenever the query itself
// came back empty. Six tabs reported as clicked; only the first ever was. The
// terminal case then ran against a DOM with no terminal in it and still passed.
//
// The lesson is that the matcher is real logic and therefore needs its own
// tests. So the predicate lives here as a plain function over plain objects,
// gets unit-tested in locators.test.ts, and is shipped into the page by
// serialising *this same function* — see `indexExpression`. There is no second
// copy in the driver that can drift away from the tested one.

/** The parts of a DOM element the matcher looks at. */
export interface ElementLike {
  textContent: string | null;
  ariaLabel: string | null;
  title: string | null;
}

/**
 * Find the first node whose accessible name contains `query`.
 *
 * Accessible name is `aria-label`, then `title`, then visible text — the order
 * a screen reader uses, and the order that makes icon-only controls findable at
 * all. Returns -1 when nothing matches, so a moved label fails the step instead
 * of silently landing on the wrong control.
 *
 * Throws on an empty query rather than matching everything. An empty query is
 * never a real intent; it means the caller's label lookup returned nothing, and
 * that mistake should surface where it happened.
 */
export function indexByAccessibleName(nodes: ElementLike[], query: string): number {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("locator query is empty — every node would match");
  }
  const needle = query.trim();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const label = (node.ariaLabel ?? "").trim()
      || (node.title ?? "").trim()
      || (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (label.includes(needle)) return i;
  }
  return -1;
}

/** JSON string literal, safe to paste into evaluated JavaScript. */
function literal(value: string): string {
  return JSON.stringify(value);
}

/**
 * An expression that resolves to the index of the matching node, or -1.
 *
 * The predicate is serialised from the function above so the page runs exactly
 * what the unit tests pin down. `query` is validated here as well, so a bad
 * lookup fails in the test process with a usable stack rather than as a remote
 * evaluation error.
 */
export function indexExpression(selector: string, query: string): string {
  indexByAccessibleName([], query); // validates; [] can only return -1
  return `(${indexByAccessibleName.toString()})(
    [...document.querySelectorAll(${literal(selector)})].map((el) => ({
      textContent: el.textContent,
      ariaLabel: el.getAttribute("aria-label"),
      title: el.getAttribute("title"),
    })),
    ${literal(query)}
  )`;
}

/**
 * An expression that clicks the matching node and reports what happened.
 *
 * Resolves to `"clicked"` or `"not-found"`. A caller that asserts on the return
 * value cannot mistake "the label is gone" for success.
 */
export function clickExpression(selector: string, query: string): string {
  return `(() => {
    const nodes = [...document.querySelectorAll(${literal(selector)})];
    const index = ${indexExpression(selector, query)};
    if (index < 0) return "not-found";
    nodes[index].click();
    return "clicked";
  })()`;
}

/**
 * An expression listing the accessible names matching `selector`.
 *
 * Used instead of a hardcoded list wherever the labels are plain strings in a
 * component rather than translation keys: the walk reads the names off the live
 * DOM and drives each one by the name it actually has. Renaming a tab then
 * cannot produce a false pass, and removing one fails the count assertion.
 */
export function accessibleNamesExpression(selector: string): string {
  return `[...document.querySelectorAll(${literal(selector)})].map((el) =>
    ((el.getAttribute("aria-label") || "").trim()
      || (el.getAttribute("title") || "").trim()
      || (el.textContent || "").replace(/\\s+/g, " ").trim()))`;
}

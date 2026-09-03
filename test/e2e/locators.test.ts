import { describe, expect, it } from "vitest";
import {
  accessibleNamesExpression,
  clickExpression,
  indexByAccessibleName,
  indexExpression,
  type ElementLike,
} from "./locators.ts";

/** Shorthand for a node with only the fields the matcher reads. */
function node(partial: Partial<ElementLike>): ElementLike {
  return { textContent: null, ariaLabel: null, title: null, ...partial };
}

// The six tool-panel tabs as the DOM actually presents them: an icon child and
// nothing else, so the accessible name is the only name there is.
const iconOnlyTabs: ElementLike[] = [
  node({ ariaLabel: "文件目录", title: "文件目录", textContent: "" }),
  node({ ariaLabel: "审查", title: "审查", textContent: "" }),
  node({ ariaLabel: "SubAgent", title: "SubAgent", textContent: "" }),
  node({ ariaLabel: "后台任务", title: "后台任务", textContent: "" }),
  node({ ariaLabel: "浏览器", title: "浏览器", textContent: "" }),
  node({ ariaLabel: "终端", title: "终端", textContent: "" }),
  node({ ariaLabel: "隐藏工具面板", title: "隐藏工具面板", textContent: "" }),
];

describe("indexByAccessibleName", () => {
  // This is the regression. The old matcher was
  // `textContent.includes(query)`, and for these nodes textContent is "" —
  // so with a query that came back empty it matched index 0 every time and
  // reported six successful tab clicks that were all the first tab.
  it("finds each icon-only tab by its accessible name", () => {
    expect(indexByAccessibleName(iconOnlyTabs, "文件目录")).toBe(0);
    expect(indexByAccessibleName(iconOnlyTabs, "审查")).toBe(1);
    expect(indexByAccessibleName(iconOnlyTabs, "SubAgent")).toBe(2);
    expect(indexByAccessibleName(iconOnlyTabs, "后台任务")).toBe(3);
    expect(indexByAccessibleName(iconOnlyTabs, "浏览器")).toBe(4);
    expect(indexByAccessibleName(iconOnlyTabs, "终端")).toBe(5);
  });

  it("refuses an empty query instead of matching everything", () => {
    expect(() => indexByAccessibleName(iconOnlyTabs, "")).toThrow(/empty/);
    expect(() => indexByAccessibleName(iconOnlyTabs, "   ")).toThrow(/empty/);
    // A label lookup that returns undefined is the realistic way this happens.
    expect(() => indexByAccessibleName(iconOnlyTabs, undefined as unknown as string)).toThrow(/empty/);
  });

  it("reports -1 for a label that is not present", () => {
    // A renamed or removed control has to fail the step. Returning 0 here is
    // precisely what turned a stale selector into a passing test.
    expect(indexByAccessibleName(iconOnlyTabs, "调用明细")).toBe(-1);
    expect(indexByAccessibleName([], "终端")).toBe(-1);
  });

  it("prefers aria-label over title over text", () => {
    const nodes = [
      node({ ariaLabel: "关闭", title: "别用我", textContent: "也别用我" }),
      node({ title: "标题匹配", textContent: "文本" }),
      node({ textContent: "只有文本" }),
    ];
    expect(indexByAccessibleName(nodes, "关闭")).toBe(0);
    expect(indexByAccessibleName(nodes, "标题匹配")).toBe(1);
    expect(indexByAccessibleName(nodes, "只有文本")).toBe(2);
    // The shadowed values are not searched — the accessible name is one string,
    // not a union, which keeps a match from landing on an invisible attribute.
    expect(indexByAccessibleName(nodes, "别用我")).toBe(-1);
  });

  it("matches visible text across layout whitespace", () => {
    const nodes = [node({ textContent: "\n  请求\n  日志\n" })];
    expect(indexByAccessibleName(nodes, "请求 日志")).toBe(0);
  });

  it("returns the first match when a label is a prefix of another", () => {
    const nodes = [node({ ariaLabel: "会话" }), node({ ariaLabel: "会话管理" })];
    expect(indexByAccessibleName(nodes, "会话")).toBe(0);
    expect(indexByAccessibleName(nodes, "会话管理")).toBe(1);
  });

  it("skips holes rather than throwing", () => {
    const sparse = [undefined as unknown as ElementLike, node({ ariaLabel: "终端" })];
    expect(indexByAccessibleName(sparse, "终端")).toBe(1);
  });
});

describe("expression builders", () => {
  // The page runs a serialised copy of the tested function. If that stops being
  // true the unit tests above would be guarding nothing.
  it("embeds the tested predicate rather than a second implementation", () => {
    expect(indexExpression(".tool-panel-tabs button", "终端")).toContain(
      indexByAccessibleName.toString(),
    );
  });

  it("validates the query at build time", () => {
    expect(() => indexExpression("button", "")).toThrow(/empty/);
    expect(() => clickExpression("button", " ")).toThrow(/empty/);
  });

  it("escapes selectors and queries into the expression", () => {
    // Labels are Chinese and selectors contain quotes and brackets; both go
    // through JSON.stringify, so neither can terminate the expression early.
    const expr = clickExpression('button[aria-label="x"]', '引号"和\\反斜杠');
    expect(expr).toContain(JSON.stringify('button[aria-label="x"]'));
    expect(expr).toContain(JSON.stringify('引号"和\\反斜杠'));
    expect(() => new Function(`return ${expr}`)).not.toThrow();
  });

  it("produces syntactically valid JavaScript", () => {
    for (const expr of [
      indexExpression(".tool-panel-tabs button", "终端"),
      clickExpression(".tool-panel-tabs button", "终端"),
      accessibleNamesExpression(".tool-panel-tabs button"),
    ]) {
      expect(() => new Function(`return ${expr}`)).not.toThrow();
    }
  });

  // Run the built expressions against a DOM stand-in, which is the closest this
  // can get to the browser without one: same shape, same call sequence.
  it("clicks the matching node and reports not-found otherwise", () => {
    const clicked: string[] = [];
    const fakeDocument = {
      querySelectorAll: () =>
        iconOnlyTabs.map((n) => ({
          textContent: n.textContent,
          getAttribute: (attr: string) => (attr === "aria-label" ? n.ariaLabel : n.title),
          click: () => clicked.push(n.ariaLabel ?? ""),
        })),
    };
    const run = (expr: string) =>
      new Function("document", `return ${expr}`)(fakeDocument);

    expect(run(clickExpression("button", "终端"))).toBe("clicked");
    expect(clicked).toEqual(["终端"]);
    expect(run(clickExpression("button", "不存在的标签"))).toBe("not-found");
    expect(clicked).toEqual(["终端"]);
    expect(run(accessibleNamesExpression("button"))).toEqual([
      "文件目录", "审查", "SubAgent", "后台任务", "浏览器", "终端", "隐藏工具面板",
    ]);
  });
});

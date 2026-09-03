import { describe, expect, it } from "vitest";
import { LANG_CODES, label, labels, missingKeys } from "./labels.ts";

describe("label", () => {
  // These four are the exact strings the previous walk got wrong. Pinning the
  // values means the test fails if a translation changes, which is the point:
  // the walk clicks these, so a change is something to notice, not absorb.
  it("returns what the app actually renders for the dashboard ranges", () => {
    expect(label("dashboard.range.today")).toBe("当天");
    expect(label("dashboard.range.7d")).toBe("7天");
    expect(label("dashboard.range.30d")).toBe("30天");
  });

  it("returns what the app actually renders for the breakdown tabs", () => {
    expect(label("dashboard.request_log")).toBe("请求日志");
    expect(label("dashboard.provider_stats")).toBe("Provider 统计");
    expect(label("dashboard.model_stats")).toBe("Model 统计");
  });

  it("returns what the app actually renders for the subagent tabs", () => {
    expect(label("subagents.tab_agents")).toBe("代理");
    expect(label("subagents.tab_chains")).toBe("流水线");
    expect(label("subagents.tab_history")).toBe("运行记录");
  });

  it("throws on an unknown key instead of echoing it back", () => {
    // `t()` returns the key so the UI degrades gracefully. A test must not:
    // searching the page for the literal "dashboard.range.tomorrow" would fail
    // with a confusing message about missing UI rather than a missing key.
    expect(() => label("dashboard.range.tomorrow")).toThrow(/missing translation key/);
  });

  it("throws on an unknown language", () => {
    expect(() => label("dashboard.range.today", "fr")).toThrow(/unknown language/);
  });

  it("serves every shipped language", () => {
    for (const lang of LANG_CODES) {
      expect(label("dashboard.range.today", lang).length).toBeGreaterThan(0);
    }
    expect(label("dashboard.range.today", "en")).toBe("Today");
    expect(label("dashboard.range.today", "zh-TW")).toBe("當天");
  });

  it("resolves several keys in order", () => {
    expect(labels(["subagents.tab_agents", "subagents.tab_chains", "subagents.tab_history"]))
      .toEqual(["代理", "流水线", "运行记录"]);
  });
});

describe("missingKeys", () => {
  // A key added to one dictionary and forgotten in another degrades to English
  // silently at runtime. Nothing surfaces it except a check like this one.
  it("reports no gaps in any shipped language", () => {
    for (const lang of LANG_CODES) {
      expect(missingKeys(lang), `${lang} is missing keys`).toEqual([]);
    }
  });
});

// Labels for the UI walk, resolved from the app's own dictionaries.
//
// The walk used to hardcode Chinese strings, and four of them were wrong:
// "今天 / 7 天 / 30 天" for what the app renders as "当天 / 7天 / 30天",
// "调用明细" for "请求日志", "链 / 历史" for "流水线 / 运行记录". Every one of
// those was a step that could never pass, dressed up as a product failure.
//
// Copying strings out of a UI is the mistake, not mistyping them. So the walk
// asks for a translation *key* and gets whatever the shipped dictionary says,
// and an unknown key throws instead of quietly yielding the key back the way
// `t()` does for the renderer. A renamed key fails the run at the first step;
// a retranslated value just changes what gets clicked, which is correct.
//
// Labels that are plain literals in a component rather than dictionary entries
// (the tool-panel tabs, the settings sections) are not duplicated here at all —
// the walk reads those off the live DOM via `accessibleNamesExpression`.

import zhCN from "../../src/lib/translations/zh-CN.ts";
import en from "../../src/lib/translations/en.ts";
import zhTW from "../../src/lib/translations/zh-TW.ts";
import ja from "../../src/lib/translations/ja.ts";

const dictionaries: Record<string, Record<string, string>> = {
  "zh-CN": zhCN,
  "en": en,
  "zh-TW": zhTW,
  "ja": ja,
};

/** All four shipped languages, for the coverage check. */
export const LANG_CODES = Object.keys(dictionaries);

/**
 * The visible text for a translation key.
 *
 * The app defaults to zh-CN on this machine, so that is the default here. An
 * unknown key throws: the walk cannot do anything useful with a label it does
 * not have, and `t()`'s key-as-fallback would turn the mistake into a step that
 * looks for the literal string "dashboard.range.today" on screen.
 */
export function label(key: string, lang = "zh-CN"): string {
  const dictionary = dictionaries[lang];
  if (!dictionary) throw new Error(`unknown language: ${lang}`);
  const value = dictionary[key];
  if (value === undefined) throw new Error(`missing translation key: ${key} (${lang})`);
  if (value.trim() === "") throw new Error(`empty translation: ${key} (${lang})`);
  return value;
}

/** Several labels at once, in order. */
export function labels(keys: string[], lang = "zh-CN"): string[] {
  return keys.map((key) => label(key, lang));
}

/**
 * Keys that exist in one language but not another.
 *
 * A key added to zh-CN and forgotten elsewhere degrades to English at runtime
 * without any visible error, which is exactly the kind of omission that reaches
 * users. Cheap to check, so it is checked.
 */
export function missingKeys(lang: string): string[] {
  const dictionary = dictionaries[lang];
  if (!dictionary) throw new Error(`unknown language: ${lang}`);
  const union = new Set(Object.values(dictionaries).flatMap((d) => Object.keys(d)));
  return [...union].filter((key) => !(key in dictionary)).sort();
}

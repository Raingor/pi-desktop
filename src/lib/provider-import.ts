export interface ImportedApiKey {
  key: string;
  /** The pasted field name, for example `key-1`; shown in the key pool. */
  label?: string;
}

export interface ParsedProviderImport {
  name: string;
  baseUrl: string;
  apiKeys: ImportedApiKey[];
  modelIds: string[];
}

const KEY_FIELD_RE = /^(apikey|api_key|api-key|keys?|token|secret)(?:\s*[-_]\s*\d+)?$/i;
const IMPORT_LABEL_RE =
  /(?<![\w/.\-])((?:apikey|api_key|api-key|keys?|token|secret)(?:\s*[-_]\s*\d+)?|baseurl|base_url|base-url|url|endpoint|地址|接口|provider|name|名称|名稱|供应商|供應商|model_ids?|modelids?|models?|模型)\s*[:：](?!\/\/)/gi;

function normalizedKeyLabel(label: string): string {
  return label.trim().replace(/\s+/g, "");
}

function cleanImportedValue(value: string): string {
  const trimmed = value.trim().replace(/[,，;；]+$/, "");
  // Pasting from Markdown commonly turns a URL into [label](https://url).
  const markdownLink = trimmed.match(/^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/i);
  if (markdownLink?.[1]) return markdownLink[1];
  // A provider name copied from a formatted note may arrive as **Name**.
  const boldText = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/);
  return boldText?.[1] ? boldText[1].trim() : trimmed;
}

function importField(label: string): "name" | "baseUrl" | "apiKey" | "models" {
  const l = label.toLowerCase();
  if (KEY_FIELD_RE.test(l)) return "apiKey";
  if (/^(baseurl|base_url|base-url|url|endpoint|地址|接口)$/.test(l)) return "baseUrl";
  if (/^(provider|name|名称|名稱|供应商|供應商)$/.test(l)) return "name";
  return "models";
}

function addKey(target: ImportedApiKey[], value: string, label?: string) {
  for (const part of value.split(/[\s,，;；]+/)) {
    const key = cleanImportedValue(part);
    if (key && !target.some((entry) => entry.key === key)) {
      target.push({ key, ...(label ? { label: normalizedKeyLabel(label) } : {}) });
    }
  }
}

/** Parse a key-only editor, allowing one key per line or `key-1: value`. */
export function parseImportedApiKeys(raw: string): ImportedApiKey[] {
  const keys: ImportedApiKey[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (match?.[1] && match[2] && KEY_FIELD_RE.test(match[1].trim())) {
      addKey(keys, match[2], match[1]);
    }
    else addKey(keys, trimmed);
  }
  return keys;
}

export function formatImportedApiKeys(keys: ImportedApiKey[]): string {
  return keys.map(({ key, label }) => (label ? `${label}: ${key}` : key)).join("\n");
}

/**
 * Parse a freeform provider snippet. Numbered key labels are intentionally
 * treated as independent values instead of letting the last one overwrite the
 * first, so an imported provider immediately receives a usable key pool.
 */
export function parseProviderImport(raw: string): ParsedProviderImport {
  const out: ParsedProviderImport = { name: "", baseUrl: "", apiKeys: [], modelIds: [] };
  const pushModels = (value: string) => {
    for (const part of value.split(/[\s,，;；]+/)) {
      const model = part.trim();
      if (model && !out.modelIds.includes(model)) out.modelIds.push(model);
    }
  };
  const assignFree = (text: string) => {
    for (const token of text.split(/\s+/)) {
      const value = cleanImportedValue(token);
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) {
        if (!out.baseUrl) out.baseUrl = value;
      } else if (/^sk-\S{8,}$/i.test(value) || /^[A-Za-z0-9_-]{32,}$/.test(value) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        addKey(out.apiKeys, value);
      } else if (value.includes("/")) {
        pushModels(value);
      } else if (!out.name) {
        out.name = value.replace(/[:：]\s*$/, "").trim();
      }
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const matches = [...line.matchAll(IMPORT_LABEL_RE)];
    const head = (matches.length ? line.slice(0, matches[0]!.index) : line).trim();
    if (head) assignFree(head);
    matches.forEach((match, index) => {
      const start = match.index! + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1]!.index! : line.length;
      const value = cleanImportedValue(line.slice(start, end));
      if (!value) return;
      const field = importField(match[1] ?? "");
      if (field === "models") pushModels(value);
      else if (field === "apiKey") addKey(out.apiKeys, value, match[1]);
      else if (!out[field]) out[field] = value;
    });
  }
  return out;
}

import { describe, expect, it } from "vitest";
import { formatImportedApiKeys, parseImportedApiKeys, parseProviderImport } from "./provider-import";

describe("parseProviderImport", () => {
  it("imports numbered key fields as a labelled, deduplicated key pool", () => {
    const parsed = parseProviderImport(`
      provider: Relay
      baseurl: https://relay.example/v1
      key-1: sk-first-key-0123456789
      api-key-2: sk-second-key-0123456789
      token-3: sk-third-key-0123456789
      modelid: relay/chat
    `);

    expect(parsed).toMatchObject({
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      modelIds: ["relay/chat"],
    });
    expect(parsed.apiKeys).toEqual([
      { label: "key-1", key: "sk-first-key-0123456789" },
      { label: "api-key-2", key: "sk-second-key-0123456789" },
      { label: "token-3", key: "sk-third-key-0123456789" },
    ]);
  });

  it("keeps a key-only editor usable with labels or bare environment references", () => {
    const keys = parseImportedApiKeys("key-1: sk-first\n$RELAY_KEY\nkey-2: sk-second");
    expect(keys).toEqual([
      { label: "key-1", key: "sk-first" },
      { key: "$RELAY_KEY" },
      { label: "key-2", key: "sk-second" },
    ]);
    expect(formatImportedApiKeys(keys)).toBe("key-1: sk-first\n$RELAY_KEY\nkey-2: sk-second");
  });

  it("normalizes Markdown provider names and endpoint links", () => {
    const parsed = parseProviderImport(`
      **Seekai**
      baseurl: [https://seekai.cc/v1](https://seekai.cc/v1)
      key-1: sk-first
      key-2: sk-second
      key-3: sk-third
    `);

    expect(parsed.name).toBe("Seekai");
    expect(parsed.baseUrl).toBe("https://seekai.cc/v1");
    expect(parsed.apiKeys.map((entry) => entry.label)).toEqual(["key-1", "key-2", "key-3"]);
  });
});

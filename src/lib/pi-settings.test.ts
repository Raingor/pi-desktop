import { describe, expect, it } from "vitest";
import { mergePiSettings } from "./pi-settings";

describe("mergePiSettings", () => {
  it("preserves sibling CLI settings in nested groups", () => {
    const current = {
      terminal: { showImages: true, showTerminalProgress: true, imageWidthCells: 80 },
      images: { autoResize: true, blockImages: false },
      warnings: { anthropicExtraUsage: true, futureWarning: false },
    };

    const merged = mergePiSettings(current, {
      terminal: { showImages: false },
      images: { blockImages: true },
      warnings: { anthropicExtraUsage: false },
    });

    expect(merged.terminal).toEqual({
      showImages: false,
      showTerminalProgress: true,
      imageWidthCells: 80,
    });
    expect(merged.images).toEqual({ autoResize: true, blockImages: true });
    expect(merged.warnings).toEqual({
      anthropicExtraUsage: false,
      futureWarning: false,
    });
  });

  it("preserves provider retry settings while updating retry itself", () => {
    const merged = mergePiSettings(
      {
        retry: {
          enabled: true,
          maxRetries: 3,
          provider: { maxRetries: 2, maxRetryDelayMs: 60_000 },
        },
      },
      { retry: { provider: { maxRetries: 4 } } }
    );

    expect(merged.retry).toEqual({
      enabled: true,
      maxRetries: 3,
      provider: { maxRetries: 4, maxRetryDelayMs: 60_000 },
    });
  });
});

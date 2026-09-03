import type { PiSettings } from "@/types";

/**
 * Merge a settings patch without dropping sibling values from Pi's nested
 * settings groups. The server persists the complete settings object, so a
 * shallow merge here could otherwise erase unrelated CLI preferences.
 */
export function mergePiSettings(
  current: PiSettings,
  partial: Partial<PiSettings>
): PiSettings {
  return {
    ...current,
    ...partial,
    ...(partial.compaction
      ? { compaction: { ...current.compaction, ...partial.compaction } }
      : {}),
    ...(partial.retry
      ? {
          retry: {
            ...current.retry,
            ...partial.retry,
            ...(partial.retry.provider
              ? {
                  provider: {
                    ...current.retry?.provider,
                    ...partial.retry.provider,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(partial.terminal
      ? { terminal: { ...current.terminal, ...partial.terminal } }
      : {}),
    ...(partial.images
      ? { images: { ...current.images, ...partial.images } }
      : {}),
    ...(partial.markdown
      ? { markdown: { ...current.markdown, ...partial.markdown } }
      : {}),
    ...(partial.warnings
      ? { warnings: { ...current.warnings, ...partial.warnings } }
      : {}),
  };
}

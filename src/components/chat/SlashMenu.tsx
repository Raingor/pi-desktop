// The "/" menu in the composer: extension commands, prompt templates and
// skills, filtered as you type.
//
// The list comes from pi (see server/slash-commands.ts), so it matches what a
// prompt starting with "/" will actually run. pi's built-in TUI commands are
// deliberately absent — they do not execute outside the interactive terminal.

import { useEffect, useMemo, useRef } from "react";
import { Blocks, FileText, Loader2, Sparkles } from "lucide-react";

export type SlashSource = "extension" | "prompt" | "skill";

export interface SlashCommand {
  name: string;
  description: string;
  source: SlashSource;
  location?: string;
  path?: string;
}

const GROUPS: { source: SlashSource; label: string; icon: typeof Blocks }[] = [
  { source: "extension", label: "扩展包命令", icon: Blocks },
  { source: "prompt", label: "提示模板", icon: FileText },
  { source: "skill", label: "技能", icon: Sparkles },
];

/** Everything from the slash up to the first space — what the user is typing. */
export function slashQuery(text: string): string | null {
  // Chinese IMEs in fullwidth-punctuation mode produce ／ (U+FF0F) from the
  // same physical key. To the user it is the same character; anything else
  // would make the menu look simply broken.
  if (!text.startsWith("/") && !text.startsWith("／")) return null;
  const token = text.slice(1);
  // A space means the command name is settled and arguments have begun.
  if (/\s/.test(token)) return null;
  return token;
}

/** Subsequence match, so "sfd" finds "skill:frontend-design". */
function fuzzyScore(name: string, query: string): number | null {
  if (!query) return 0;
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.startsWith(needle)) return 0;
  const direct = haystack.indexOf(needle);
  if (direct > 0) return 1 + direct;
  let at = -1;
  for (const ch of needle) {
    at = haystack.indexOf(ch, at + 1);
    if (at < 0) return null;
  }
  return 100 + at;
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const scored: { cmd: SlashCommand; score: number }[] = [];
  for (const cmd of commands) {
    const score = fuzzyScore(cmd.name, query);
    if (score !== null) scored.push({ cmd, score });
  }
  // Preserve the server's grouping for equal scores by using a stable sort.
  return scored.sort((a, b) => a.score - b.score).map((s) => s.cmd);
}

export function SlashMenu({
  commands,
  loading,
  error,
  query,
  activeIndex,
  onHover,
  onPick,
}: {
  commands: SlashCommand[];
  loading: boolean;
  error?: string;
  query: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: SlashCommand) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard selection in view.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const grouped = useMemo(() => {
    const out: { label: string; icon: typeof Blocks; items: { cmd: SlashCommand; index: number }[] }[] = [];
    commands.forEach((cmd, index) => {
      const group = GROUPS.find((g) => g.source === cmd.source);
      if (!group) return;
      const bucket = out.find((b) => b.label === group.label);
      if (bucket) bucket.items.push({ cmd, index });
      else out.push({ label: group.label, icon: group.icon, items: [{ cmd, index }] });
    });
    return out;
  }, [commands]);

  if (loading && commands.length === 0) {
    return (
      <div className="codex-slash-menu">
        <div className="codex-slash-empty">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在读取可用命令…
        </div>
      </div>
    );
  }

  if (commands.length === 0) {
    return (
      <div className="codex-slash-menu">
        <div className="codex-slash-empty">
          {error ? `无法读取命令：${error}` : query ? `没有匹配「/${query}」的命令` : "没有可用命令"}
        </div>
      </div>
    );
  }

  return (
    <div className="codex-slash-menu" ref={listRef}>
      {grouped.map((group) => (
        <div key={group.label} className="codex-slash-group">
          <p>
            <group.icon className="h-3 w-3" />
            {group.label}
            <span>{group.items.length}</span>
          </p>
          {group.items.map(({ cmd, index }) => (
            <button
              key={`${cmd.source}-${cmd.name}`}
              type="button"
              data-index={index}
              className={`codex-slash-item${index === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => onHover(index)}
              // mousedown, not click: the textarea's blur must not close the
              // menu before the pick lands.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(cmd);
              }}
              title={cmd.path ?? cmd.name}
            >
              <code>/{cmd.name}</code>
              {cmd.description && <span>{cmd.description}</span>}
              {cmd.location && <em>{cmd.location}</em>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

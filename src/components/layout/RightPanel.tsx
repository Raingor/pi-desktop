// Right-hand tool panel: file browser, git review, subagent runs, background
// tasks, an embedded browser, a command terminal and image/video generation.
//
// Hidden by default; the toggle lives in the window's top-right corner. The
// open state, active tab and width all persist so the panel comes back the way
// it was left. Panels stay mounted only while selected — the terminal and
// subagent views poll, and there is no reason to poll something invisible.

import { useState } from "react";
import {
  FolderTree,
  GitPullRequestArrow,
  Globe,
  History,
  ListChecks,
  Sparkles,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { FilesPanel } from "@/components/tools/FilesPanel";
import { ReviewPanel } from "@/components/tools/ReviewPanel";
import { SubagentPanel } from "@/components/tools/SubagentPanel";
import { TasksPanel } from "@/components/tools/TasksPanel";
import { BrowserPanel } from "@/components/tools/BrowserPanel";
import { TerminalPanel } from "@/components/tools/TerminalPanel";
import { GeneratePanel } from "@/components/tools/GeneratePanel";
import { PromptLogPanel } from "@/components/tools/PromptLogPanel";

export type ToolTab = "files" | "review" | "subagents" | "tasks" | "browser" | "terminal" | "generate" | "prompts";

export const TOOL_TABS: { key: ToolTab; label: string; icon: typeof FolderTree }[] = [
  { key: "files", label: "文件目录", icon: FolderTree },
  { key: "review", label: "审查", icon: GitPullRequestArrow },
  { key: "subagents", label: "SubAgent", icon: Users },
  { key: "tasks", label: "后台任务", icon: ListChecks },
  { key: "browser", label: "浏览器", icon: Globe },
  { key: "terminal", label: "终端", icon: TerminalSquare },
  { key: "generate", label: "生图 / 生视频", icon: Sparkles },
  { key: "prompts", label: "发送记录", icon: History },
];

export function RightPanel({
  tab,
  onTabChange,
  onClose,
}: {
  tab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  onClose: () => void;
}) {
  // Set when the tasks panel asks the terminal to show a specific task.
  const [attachTaskId, setAttachTaskId] = useState<string | null>(null);

  const openTaskInTerminal = (id: string) => {
    setAttachTaskId(id);
    onTabChange("terminal");
  };

  return (
    <aside className="tool-panel" aria-label="工具面板">
      <nav className="tool-panel-tabs">
        {TOOL_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tool-panel-tab${tab === key ? " is-active" : ""}`}
            onClick={() => onTabChange(key)}
            title={label}
            aria-label={label}
            aria-current={tab === key}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <button
          className="tool-panel-tab tool-panel-close"
          onClick={onClose}
          title="隐藏工具面板"
          aria-label="隐藏工具面板"
        >
          <X className="h-4 w-4" />
        </button>
      </nav>

      <div className="tool-panel-stage">
        {tab === "files" && <FilesPanel />}
        {tab === "review" && <ReviewPanel />}
        {tab === "subagents" && <SubagentPanel />}
        {tab === "tasks" && <TasksPanel onOpenTask={openTaskInTerminal} />}
        {tab === "browser" && <BrowserPanel />}
        {tab === "terminal" && (
          <TerminalPanel
            attachTaskId={attachTaskId}
            onAttached={() => setAttachTaskId(null)}
          />
        )}
        {tab === "generate" && <GeneratePanel />}
        {tab === "prompts" && <PromptLogPanel />}
      </div>
    </aside>
  );
}

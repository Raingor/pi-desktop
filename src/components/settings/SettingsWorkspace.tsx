import { useState } from "react";
import { Activity, Brain, Gauge, LayoutDashboard, Plug, Settings2, SlidersHorizontal, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { ProvidersModelsPage } from "@/components/providers/ProvidersModelsPage";
import { SubagentsPage } from "@/components/subagents/SubagentsPage";
import { ModelSpeedTestPage } from "@/components/speedtest/ModelSpeedTestPage";
import { SettingsPage } from "./SettingsPage";

type Section = "general" | "overview" | "providers" | "subagents" | "sessions" | "memory" | "speed";
const sections: { key: Section; label: string; icon: typeof Settings2; group: string }[] = [
  { key: "general", label: "通用", icon: Settings2, group: "工作区" },
  { key: "overview", label: "概览与使用统计", icon: LayoutDashboard, group: "工作区" },
  { key: "providers", label: "提供商与模型", icon: Plug, group: "配置" },
  { key: "subagents", label: "子代理", icon: Users, group: "配置" },
  { key: "speed", label: "模型测速", icon: Gauge, group: "工具" },
  { key: "sessions", label: "会话管理", icon: Activity, group: "数据" },
  { key: "memory", label: "记忆", icon: Brain, group: "数据" },
];

export function SettingsWorkspace() {
  const [active, setActive] = useState<Section>("general");
  const content: Record<Section, React.ReactNode> = { general: <SettingsPage />, overview: <DashboardPage />, providers: <ProvidersModelsPage />, subagents: <SubagentsPage />, sessions: <SessionsPage />, memory: <MemoryPage />, speed: <ModelSpeedTestPage /> };
  let lastGroup = "";
  return <div className="codex-settings-workspace"><aside className="codex-settings-nav"><header><div className="codex-settings-icon"><SlidersHorizontal className="h-5 w-5" /></div><div><h1>设置</h1><p>Pi 本地工作区</p></div></header><nav>{sections.map(({ key, label, icon: Icon, group }) => { const groupLabel = group !== lastGroup ? group : ""; lastGroup = group; return <div key={key}>{groupLabel && <p className="codex-settings-group">{groupLabel}</p>}<button onClick={() => setActive(key)} className={cn(active === key && "is-active")}><Icon className="h-4 w-4" />{label}</button></div>; })}</nav></aside><section className="codex-settings-content">{content[active]}</section></div>;
}

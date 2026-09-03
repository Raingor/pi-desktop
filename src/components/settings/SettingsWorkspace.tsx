import { Suspense, lazy, useState, type ComponentType } from "react";
import { Activity, ArrowLeft, Brain, Gauge, LayoutDashboard, Plug, Settings2, SlidersHorizontal, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

// Loaded on demand. Chat is the app's main surface; these seven pages are
// visited occasionally but used to be bundled into the entry chunk, dragging
// recharts and the 2700-line provider editor into the startup path with them.
// One section is on screen at a time, so there is nothing to gain from having
// the other six parsed up front.
const SettingsPage = lazy(() => import("./SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DashboardPage = lazy(() => import("@/components/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ProvidersModelsPage = lazy(() => import("@/components/providers/ProvidersModelsPage").then((m) => ({ default: m.ProvidersModelsPage })));
const SubagentsPage = lazy(() => import("@/components/subagents/SubagentsPage").then((m) => ({ default: m.SubagentsPage })));
const ModelSpeedTestPage = lazy(() => import("@/components/speedtest/ModelSpeedTestPage").then((m) => ({ default: m.ModelSpeedTestPage })));
const SessionsPage = lazy(() => import("@/components/sessions/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const MemoryPage = lazy(() => import("@/components/sessions/MemoryPage").then((m) => ({ default: m.MemoryPage })));

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

const pages: Record<Section, ComponentType> = {
  general: SettingsPage,
  overview: DashboardPage,
  providers: ProvidersModelsPage,
  subagents: SubagentsPage,
  sessions: SessionsPage,
  memory: MemoryPage,
  speed: ModelSpeedTestPage,
};

/**
 * Standalone settings page: its own full-screen layout with the settings
 * navigation on the left — no chat sidebar. Reached via /settings.
 */
export function SettingsWorkspace() {
  const [active, setActive] = useState<Section>("general");
  const ActivePage = pages[active];
  let lastGroup = "";
  return (
    <div className="settings-page">
      <aside className="settings-page-nav">
        <header>
          <div className="codex-settings-icon"><SlidersHorizontal className="h-5 w-5" /></div>
          <div>
            <h1>设置</h1>
            <p>Pi 本地工作区</p>
          </div>
        </header>
        <nav>
          {sections.map(({ key, label, icon: Icon, group }) => {
            const groupLabel = group !== lastGroup ? group : "";
            lastGroup = group;
            return (
              <div key={key}>
                {groupLabel && <p className="codex-settings-group">{groupLabel}</p>}
                <button onClick={() => setActive(key)} className={cn(active === key && "is-active")}>
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              </div>
            );
          })}
        </nav>
        <Link to="/" className="settings-page-back">
          <ArrowLeft className="h-4 w-4" />
          <span>返回对话</span>
        </Link>
      </aside>
      <section className="settings-page-content">
        <div className="settings-page-inner">
          {/* Chunks are served from the local API server, so the fallback is
              only ever a frame or two — a spinner would just flash. */}
          <Suspense fallback={<div className="settings-page-loading">载入中…</div>}>
            <ActivePage />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

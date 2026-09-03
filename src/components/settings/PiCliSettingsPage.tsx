import { useMemo, useState } from "react";
import {
  Braces,
  CheckCircle2,
  CircleAlert,
  Eye,
  Image,
  MessageSquareMore,
  Monitor,
  Network,
  Save,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import type { PiSettings, PiThinkingLevel } from "@/types";

type SettingsPatch = Partial<PiSettings>;

interface Choice {
  value: string | number;
  label: string;
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="flex items-start gap-3 border-b border-gray-800 px-5 py-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-800">
          <Icon className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-gray-800/70 px-5">{children}</div>
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-300">{label}</p>
        <p className="mt-0.5 max-w-2xl text-xs leading-5 text-gray-500">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full border transition-[background-color,border-color,box-shadow] disabled:cursor-wait disabled:opacity-60 ${
        checked
          ? "border-cyan-300/80 bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.25)]"
          : "border-slate-600 bg-slate-800/90"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Select({
  value,
  choices,
  disabled,
  label,
  onChange,
}: {
  value: string | number;
  choices: Choice[];
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      name={label}
      value={String(value)}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-40 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500 disabled:cursor-wait disabled:opacity-60"
    >
      {choices.map((choice) => (
        <option key={String(choice.value)} value={String(choice.value)}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

const BOOLEAN_CHOICES = [
  { value: "true", label: "开启" },
  { value: "false", label: "关闭" },
];

const THINKING_LEVELS: PiThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function PiCliSettingsPage() {
  const { settings, allModels, updateSettings } = useConfigStore();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  const save = async (key: string, patch: SettingsPatch) => {
    setSavingKey(key);
    setSaveState("idle");
    const ok = await updateSettings(patch);
    setSavingKey(null);
    setSaveState(ok ? "saved" : "error");
  };

  const modelOptions = useMemo(
    () =>
      allModels
        .map((model) => ({
          key: `${model.providerId}/${model.id}`,
          label: `${model.name || model.id} · ${model.providerName}`,
          reasoning: model.reasoning ?? false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [allModels]
  );

  const selectedModelInfo = modelOptions.find((model) => model.key === selectedModel);
  const visibleModelOptions = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    const pinnedKeys = new Set([
      selectedModel,
      ...Object.keys(settings?.modelThinkingLevels ?? {}),
    ].filter(Boolean));
    const pinned = modelOptions.filter((model) => pinnedKeys.has(model.key));
    const matched = modelOptions.filter((model) => {
      if (pinnedKeys.has(model.key)) return false;
      return !query || `${model.label} ${model.key}`.toLocaleLowerCase().includes(query);
    });
    return [...pinned, ...matched].slice(0, 80);
  }, [modelOptions, modelQuery, selectedModel, settings?.modelThinkingLevels]);
  const selectedThinkingLevel = selectedModel
    ? settings?.modelThinkingLevels?.[selectedModel] ?? ""
    : "";

  const updateModelThinking = (value: string) => {
    if (!selectedModel) return;
    const next = { ...(settings?.modelThinkingLevels ?? {}) };
    if (!value) delete next[selectedModel];
    else next[selectedModel] = value as PiThinkingLevel;
    void save("modelThinkingLevels", { modelThinkingLevels: next });
  };

  if (!settings) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-sm text-gray-500">
        正在读取 Pi CLI 设置…
      </div>
    );
  }

  const isSaving = (key: string) => savingKey === key;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/25 bg-blue-500/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <div>
            <p className="text-sm font-medium text-gray-300">与 Pi CLI 的 /settings 共用配置</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">
              修改后立即写入 ~/.pi/agent/settings.json；主题和默认模型仍分别在“外观”和“模型”页设置。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {savingKey && <><Save className="h-3.5 w-3.5 animate-pulse text-blue-400" /><span className="text-blue-400">保存中</span></>}
          {!savingKey && saveState === "saved" && <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /><span className="text-emerald-400">已保存</span></>}
          {!savingKey && saveState === "error" && <><CircleAlert className="h-3.5 w-3.5 text-red-400" /><span className="text-red-400">保存失败</span></>}
        </div>
      </div>

      <Section
        icon={MessageSquareMore}
        title="上下文与消息"
        description="控制上下文压缩、流式回复期间的消息队列，以及思考内容和 Markdown 图表的显示方式。"
      >
        <Row label="自动压缩上下文" description="上下文过大时自动执行 compact，避免超过模型窗口。">
          <Toggle label="自动压缩上下文" checked={settings.compaction?.enabled ?? true} disabled={isSaving("compaction.enabled")} onChange={(value) => void save("compaction.enabled", { compaction: { enabled: value } })} />
        </Row>
        <Row label="流式引导消息" description="生成过程中按 Enter 提交消息时，一次交付一条，或一次交付全部排队消息。">
          <Select label="流式引导消息" value={settings.steeringMode ?? "one-at-a-time"} disabled={isSaving("steeringMode")} choices={[{ value: "one-at-a-time", label: "逐条处理" }, { value: "all", label: "一次处理全部" }]} onChange={(value) => void save("steeringMode", { steeringMode: value as PiSettings["steeringMode"] })} />
        </Row>
        <Row label="后续消息" description="Agent 停止后处理排队的 follow-up 消息时采用的交付方式。">
          <Select label="后续消息" value={settings.followUpMode ?? "one-at-a-time"} disabled={isSaving("followUpMode")} choices={[{ value: "one-at-a-time", label: "逐条处理" }, { value: "all", label: "一次处理全部" }]} onChange={(value) => void save("followUpMode", { followUpMode: value as PiSettings["followUpMode"] })} />
        </Row>
        <Row label="隐藏思考过程" description="在助手回复中隐藏 thinking 区块；不会改变模型实际的推理等级。">
          <Toggle label="隐藏思考过程" checked={settings.hideThinkingBlock ?? false} disabled={isSaving("hideThinkingBlock")} onChange={(value) => void save("hideThinkingBlock", { hideThinkingBlock: value })} />
        </Row>
        <Row label="Mermaid 图表" description="控制终端中 Mermaid 代码块转换为 Unicode 图表的时机。">
          <Select label="Mermaid 图表" value={settings.markdown?.mermaid ?? "streaming"} disabled={isSaving("markdown.mermaid")} choices={[{ value: "off", label: "关闭" }, { value: "final", label: "回复完成后" }, { value: "streaming", label: "流式渲染" }]} onChange={(value) => void save("markdown.mermaid", { markdown: { mermaid: value as NonNullable<PiSettings["markdown"]>["mermaid"] } })} />
        </Row>
        <Row label="缓存未命中提示" description="在缓存明显未命中或压缩产生额外成本时显示提示。">
          <Toggle label="缓存未命中提示" checked={settings.showCacheMissNotices ?? false} disabled={isSaving("showCacheMissNotices")} onChange={(value) => void save("showCacheMissNotices", { showCacheMissNotices: value })} />
        </Row>
        <Row label="技能命令" description="把已安装 Skills 注册成 /skill:name 形式的 CLI 命令。">
          <Toggle label="技能命令" checked={settings.enableSkillCommands ?? true} disabled={isSaving("enableSkillCommands")} onChange={(value) => void save("enableSkillCommands", { enableSkillCommands: value })} />
        </Row>
      </Section>

      <Section
        icon={Image}
        title="图片与终端"
        description="对应 Pi TUI 的图片渲染、输入区布局、终端清理和进度指示设置。"
      >
        <Row label="显示图片" description="在支持 Kitty 或 iTerm2 图片协议的终端中行内渲染图片。">
          <Toggle label="显示图片" checked={settings.terminal?.showImages ?? true} disabled={isSaving("terminal.showImages")} onChange={(value) => void save("terminal.showImages", { terminal: { showImages: value } })} />
        </Row>
        <Row label="图片显示宽度" description="行内图片首选宽度，单位为终端字符格。">
          <Select label="图片显示宽度" value={settings.terminal?.imageWidthCells ?? 60} disabled={isSaving("terminal.imageWidthCells")} choices={[60, 80, 120].map((value) => ({ value, label: `${value} 格` }))} onChange={(value) => void save("terminal.imageWidthCells", { terminal: { imageWidthCells: Number(value) } })} />
        </Row>
        <Row label="自动调整图片" description="发送给模型前，将过大的图片缩放到最大 2000 × 2000。">
          <Toggle label="自动调整图片" checked={settings.images?.autoResize ?? true} disabled={isSaving("images.autoResize")} onChange={(value) => void save("images.autoResize", { images: { autoResize: value } })} />
        </Row>
        <Row label="阻止发送图片" description="禁止把图片内容发送给任何 LLM 提供商。">
          <Toggle label="阻止发送图片" checked={settings.images?.blockImages ?? false} disabled={isSaving("images.blockImages")} onChange={(value) => void save("images.blockImages", { images: { blockImages: value } })} />
        </Row>
        <Row label="显示硬件光标" description="显示终端光标，同时保留用于输入法的定位支持。">
          <Toggle label="显示硬件光标" checked={settings.showHardwareCursor ?? false} disabled={isSaving("showHardwareCursor")} onChange={(value) => void save("showHardwareCursor", { showHardwareCursor: value })} />
        </Row>
        <Row label="编辑器水平留白" description="输入编辑器左右两侧的字符格数量。">
          <Select label="编辑器水平留白" value={settings.editorPaddingX ?? 0} disabled={isSaving("editorPaddingX")} choices={[0, 1, 2, 3].map((value) => ({ value, label: String(value) }))} onChange={(value) => void save("editorPaddingX", { editorPaddingX: Number(value) as PiSettings["editorPaddingX"] })} />
        </Row>
        <Row label="输出水平留白" description="用户消息、助手回复和思考区块的水平留白。">
          <Select label="输出水平留白" value={settings.outputPad ?? 1} disabled={isSaving("outputPad")} choices={[0, 1].map((value) => ({ value, label: String(value) }))} onChange={(value) => void save("outputPad", { outputPad: Number(value) as PiSettings["outputPad"] })} />
        </Row>
        <Row label="自动补全可见项" description="自动补全下拉菜单最多同时显示的项目数。">
          <Select label="自动补全可见项" value={settings.autocompleteMaxVisible ?? 5} disabled={isSaving("autocompleteMaxVisible")} choices={[3, 5, 7, 10, 15, 20].map((value) => ({ value, label: `${value} 项` }))} onChange={(value) => void save("autocompleteMaxVisible", { autocompleteMaxVisible: Number(value) as PiSettings["autocompleteMaxVisible"] })} />
        </Row>
        <Row label="窗口缩小时清理空行" description="内容收缩时清除残留空行；部分终端中可能出现轻微闪烁。">
          <Toggle label="窗口缩小时清理空行" checked={settings.terminal?.clearOnShrink ?? false} disabled={isSaving("terminal.clearOnShrink")} onChange={(value) => void save("terminal.clearOnShrink", { terminal: { clearOnShrink: value } })} />
        </Row>
        <Row label="终端进度指示" description="通过 OSC 9;4 在终端标签页显示请求进度。">
          <Toggle label="终端进度指示" checked={settings.terminal?.showTerminalProgress ?? false} disabled={isSaving("terminal.showTerminalProgress")} onChange={(value) => void save("terminal.showTerminalProgress", { terminal: { showTerminalProgress: value } })} />
        </Row>
      </Section>

      <Section
        icon={Network}
        title="连接与启动"
        description="设置提供商连接方式、HTTP 无响应判定，以及 Pi 启动与更新后的提示行为。"
      >
        <Row label="连接传输方式" description="用于同时支持多种传输协议的提供商；自动通常是最稳妥的选择。">
          <Select label="连接传输方式" value={settings.transport ?? "auto"} disabled={isSaving("transport")} choices={[{ value: "auto", label: "自动" }, { value: "sse", label: "SSE" }, { value: "websocket", label: "WebSocket" }, { value: "websocket-cached", label: "WebSocket Cached" }]} onChange={(value) => void save("transport", { transport: value as PiSettings["transport"] })} />
        </Row>
        <Row label="HTTP 空闲超时" description="等待响应头或正文数据块时允许的最大空闲间隔；本地慢模型可选择禁用。">
          <Select label="HTTP 空闲超时" value={settings.httpIdleTimeoutMs ?? 300_000} disabled={isSaving("httpIdleTimeoutMs")} choices={[{ value: 30_000, label: "30 秒" }, { value: 60_000, label: "1 分钟" }, { value: 120_000, label: "2 分钟" }, { value: 300_000, label: "5 分钟" }, { value: 0, label: "禁用" }]} onChange={(value) => void save("httpIdleTimeoutMs", { httpIdleTimeoutMs: Number(value) })} />
        </Row>
        <Row label="精简启动输出" description="关闭启动时的详细说明，让 Pi 更快进入输入状态。">
          <Toggle label="精简启动输出" checked={settings.quietStartup ?? false} disabled={isSaving("quietStartup")} onChange={(value) => void save("quietStartup", { quietStartup: value })} />
        </Row>
        <Row label="折叠更新日志" description="升级后仅显示精简版 changelog。">
          <Toggle label="折叠更新日志" checked={settings.collapseChangelog ?? false} disabled={isSaving("collapseChangelog")} onChange={(value) => void save("collapseChangelog", { collapseChangelog: value })} />
        </Row>
        <Row label="安装遥测" description="检测到版本更新后发送匿名的版本/更新 ping。">
          <Toggle label="安装遥测" checked={settings.enableInstallTelemetry ?? true} disabled={isSaving("enableInstallTelemetry")} onChange={(value) => void save("enableInstallTelemetry", { enableInstallTelemetry: value })} />
        </Row>
      </Section>

      <Section
        icon={ShieldCheck}
        title="安全与会话树"
        description="控制项目默认信任策略、双击 Escape 行为、/tree 默认过滤和费用警告。"
      >
        <Row label="默认项目信任" description="没有扩展或已保存决定时采用的项目目录信任策略。">
          <Select label="默认项目信任" value={settings.defaultProjectTrust ?? "ask"} disabled={isSaving("defaultProjectTrust")} choices={[{ value: "ask", label: "每次询问" }, { value: "always", label: "始终信任" }, { value: "never", label: "永不信任" }]} onChange={(value) => void save("defaultProjectTrust", { defaultProjectTrust: value as PiSettings["defaultProjectTrust"] })} />
        </Row>
        <Row label="双击 Escape" description="编辑器为空时连续按两次 Escape 执行的操作。">
          <Select label="双击 Escape" value={settings.doubleEscapeAction ?? "tree"} disabled={isSaving("doubleEscapeAction")} choices={[{ value: "tree", label: "打开会话树" }, { value: "fork", label: "分叉会话" }, { value: "none", label: "不执行操作" }]} onChange={(value) => void save("doubleEscapeAction", { doubleEscapeAction: value as PiSettings["doubleEscapeAction"] })} />
        </Row>
        <Row label="会话树默认过滤" description="打开 /tree 时默认显示哪些消息节点。">
          <Select label="会话树默认过滤" value={settings.treeFilterMode ?? "default"} disabled={isSaving("treeFilterMode")} choices={[{ value: "default", label: "默认" }, { value: "no-tools", label: "隐藏工具消息" }, { value: "user-only", label: "仅用户消息" }, { value: "labeled-only", label: "仅有标签节点" }, { value: "all", label: "全部" }]} onChange={(value) => void save("treeFilterMode", { treeFilterMode: value as PiSettings["treeFilterMode"] })} />
        </Row>
        <Row label="Anthropic 额外用量警告" description="订阅授权可能产生额外付费用量时发出警告。">
          <Toggle label="Anthropic 额外用量警告" checked={settings.warnings?.anthropicExtraUsage ?? true} disabled={isSaving("warnings.anthropicExtraUsage")} onChange={(value) => void save("warnings.anthropicExtraUsage", { warnings: { anthropicExtraUsage: value } })} />
        </Row>
      </Section>

      <Section
        icon={Monitor}
        title="TUI 与全屏"
        description="Pi 终端界面的布局模式，以及退出、滚动条和文本选择行为。"
      >
        <Row label="TUI 模式" description="全屏模式仍属于实验功能；常规模式兼容性更好。">
          <Select label="TUI 模式" value={settings.tuiMode ?? "regular"} disabled={isSaving("tuiMode")} choices={[{ value: "regular", label: "常规" }, { value: "fullscreen", label: "全屏（实验）" }]} onChange={(value) => void save("tuiMode", { tuiMode: value as PiSettings["tuiMode"] })} />
        </Row>
        <Row label="退出全屏时输出" description="退出全屏后打印完整记录，或只打印恢复会话的提示。">
          <Select label="退出全屏时输出" value={settings.fullscreenExitOutput ?? "transcript"} disabled={isSaving("fullscreenExitOutput")} choices={[{ value: "transcript", label: "完整会话记录" }, { value: "resume-hint", label: "仅恢复提示" }]} onChange={(value) => void save("fullscreenExitOutput", { fullscreenExitOutput: value as PiSettings["fullscreenExitOutput"] })} />
        </Row>
        <Row label="全屏滚动条" description="仅对全屏模式生效。">
          <Select label="全屏滚动条" value={settings.fullscreenScrollbar ?? "auto"} disabled={isSaving("fullscreenScrollbar")} choices={[{ value: "auto", label: "自动" }, { value: "always", label: "始终显示" }, { value: "hidden", label: "隐藏" }]} onChange={(value) => void save("fullscreenScrollbar", { fullscreenScrollbar: value as PiSettings["fullscreenScrollbar"] })} />
        </Row>
        <Row label="选择后自动复制" description="全屏模式中选中文本即复制；关闭后使用 Ctrl+X 复制选区。">
          <Toggle label="选择后自动复制" checked={settings.fullscreenCopyOnSelect ?? true} disabled={isSaving("fullscreenCopyOnSelect")} onChange={(value) => void save("fullscreenCopyOnSelect", { fullscreenCopyOnSelect: value })} />
        </Row>
      </Section>

      <Section
        icon={Sparkles}
        title="按模型设置思考等级"
        description="为特定 provider/model 覆盖全局默认思考等级；清除覆盖后会重新跟随模型页的全局设置。"
      >
        <div className="grid gap-3 py-4 md:grid-cols-[minmax(180px,.72fr)_minmax(0,1.28fr)_220px]">
          <label className="grid gap-1.5 text-xs text-gray-500">
            搜索模型
            <input
              type="search"
              name="model-search"
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder="名称、提供商或模型 ID"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-500"
            />
          </label>
          <label className="grid gap-1.5 text-xs text-gray-500">
            模型
            <select
              name="model-thinking-model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500"
            >
              <option value="">选择一个模型</option>
              {visibleModelOptions.map((model) => (
                <option key={model.key} value={model.key}>{model.label}</option>
              ))}
            </select>
            <span className="font-normal text-[10px] text-gray-600">
              显示 {visibleModelOptions.length} / {modelOptions.length} 个模型
            </span>
          </label>
          <label className="grid gap-1.5 text-xs text-gray-500">
            默认思考等级
            <select
              name="model-thinking-level"
              value={selectedThinkingLevel}
              disabled={!selectedModel || isSaving("modelThinkingLevels")}
              onChange={(event) => updateModelThinking(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">跟随全局默认</option>
              {(selectedModelInfo?.reasoning ? THINKING_LEVELS : ["off"]).map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
        </div>
        {Object.keys(settings.modelThinkingLevels ?? {}).length > 0 && (
          <div className="border-t border-gray-800/70 py-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500">
              <Braces className="h-3.5 w-3.5" />
              当前覆盖 {Object.keys(settings.modelThinkingLevels ?? {}).length} 项
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(settings.modelThinkingLevels ?? {}).map(([model, level]) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => setSelectedModel(model)}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 font-mono text-[11px] text-gray-400 hover:border-blue-500/60 hover:text-blue-400"
                >
                  {model} · {level}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <div className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3 text-xs leading-5 text-gray-500">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        本页按当前安装的 Pi 0.84.4 /settings 菜单映射。未在该菜单中出现的底层实验字段不会被改写。
      </div>
    </div>
  );
}

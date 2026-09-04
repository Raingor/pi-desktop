import {
  FormEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Gauge,
  Loader2,
  MessageSquare,
  Pencil,
  Square,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { createStreamBuffer, type StreamBuffer } from "@/lib/stream-buffer";
import { usePolling } from "@/hooks/usePolling";
import { useTranslation } from "@/lib/i18n";
import { CompactButton } from "./CompactButton";
import { SlashMenu, filterCommands, slashQuery, type SlashCommand } from "./SlashMenu";
import { resolveWorkspaceCwd, useWorkspace } from "@/lib/workspace";
import { useConfigStore } from "@/store/config-store";

interface Message {
  id?: string;
  role: "user" | "assistant";
  text: string;
  kind?: "text" | "tool";
}
/** A streamed step of pi's work shown between the prompt and the answer. */
interface RunStep {
  kind: "thinking" | "tool" | "tool_result";
  text?: string;
  toolName?: string;
  args?: string;
  isError?: boolean;
}
interface SessionHistory {
  messages: Message[];
  total: number;
  /** Model / thinking level the session was last run with, from its JSONL. */
  model?: { providerId?: string; modelId?: string; thinkingLevel?: string };
}
interface ProjectGroup {
  projectPath: string;
  projectName: string;
}
interface SessionUsage {
  sessionId: string;
  providerId?: string;
  modelId?: string;
  requests: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  lastContextTokens: number;
  contextWindow?: number;
  cacheHitRate: number;
}

interface SessionInfo {
  sessionId: string;
  cwd?: string;
  filePath?: string;
  intercomId: string;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * How far from the bottom of the transcript still counts as "reading the
 * latest".
 *
 * One threshold serves both the jump-to-bottom button and the decision to
 * follow a streaming answer, so the button appearing and the view stopping
 * following are the same event rather than two that can disagree.
 */
const AT_BOTTOM_SLACK_PX = 80;

const distanceFromBottom = (container: HTMLDivElement) =>
  container.scrollHeight - container.scrollTop - container.clientHeight;

const THINKING_OPTIONS = [
  ["", "Default"],
  ["off", "Off"],
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Maximum"],
] as const;
type ThinkingLevel = Exclude<(typeof THINKING_OPTIONS)[number][0], "">;
const STANDARD_THINKING_OPTIONS = THINKING_OPTIONS.filter(([level]) =>
  ["low", "medium", "high", "max"].includes(level),
);

/**
 * One turn's markdown.
 *
 * Memoised because a streaming answer re-renders ChatPage on every repaint,
 * and without this every earlier turn is re-parsed through remark each time.
 * Measured at ~1ms per 550 characters, a 200-turn conversation spent ~43ms per
 * repaint re-parsing text that had not changed, and a 1000-turn one ~252ms —
 * so the window froze in exactly the sessions worth keeping. The prop is a
 * plain string, so the default shallow comparison is the right one.
 */
const MessageText = memo(function MessageText({ text }: { text: string }) {
  return (
    <div className="codex-message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export function ChatPage() {
  const { allModels, allProviders, settings } = useConfigStore();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? undefined;
  const preserveMessagesAfterCreate = useRef(false);
  const scrollToLatestAfterHistory = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");

  // ─── "/" command menu ──────────────────────────────
  // The registry is enumerated by starting pi, which takes seconds, so it is
  // fetched once on mount rather than when "/" is first typed.
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [slashLoading, setSlashLoading] = useState(true);
  const [slashError, setSlashError] = useState<string | undefined>();
  const [slashIndex, setSlashIndex] = useState(0);
  // Set when a pick fills the textarea, so the menu does not immediately
  // reopen on the text it just inserted.
  const [slashDismissed, setSlashDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pi/slash-commands")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { commands?: SlashCommand[]; error?: string } | null) => {
        if (cancelled) return;
        setSlashCommands(data?.commands ?? []);
        setSlashError(data?.error);
      })
      .catch(() => {
        if (!cancelled) setSlashError("读取失败");
      })
      .finally(() => {
        if (!cancelled) setSlashLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slashToken = slashDismissed ? null : slashQuery(prompt);
  const slashMatches = useMemo(
    () => (slashToken === null ? [] : filterCommands(slashCommands, slashToken)),
    [slashCommands, slashToken],
  );
  const slashOpen = slashToken !== null;

  // Reset the highlight whenever the candidate set changes.
  useEffect(() => {
    setSlashIndex(0);
  }, [slashToken]);

  const pickSlash = (command: SlashCommand) => {
    // Leave a trailing space: most of these take arguments, and it also closes
    // the menu because the token is then complete.
    setPrompt(`/${command.name} `);
    setSlashDismissed(true);
    promptRef.current?.focus();
  };
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [activeRunSessionId, setActiveRunSessionId] = useState<string | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [customProject, setCustomProject] = useState(false);
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  // "在此目录发起对话" links land on /chat?project=<abs path>: seed the
  // working directory from the URL so the next prompt runs in that project.
  const requestedProjectPath = searchParams.get("project") ?? "";
  useEffect(() => {
    if (!requestedProjectPath) return;
    setProjectPath(requestedProjectPath);
    setCustomProject(false);
  }, [requestedProjectPath]);
  // Directory a prompt runs in when no project is picked. A GUI launch has
  // cwd "/", so the server resolves a sensible fallback and reports it here
  // instead of the UI hardcoding a project name.
  const [defaultCwd, setDefaultCwd] = useState<{ path: string; name: string } | null>(null);
  // Keep the tool panel pointed at whatever directory a prompt would run in.
  // The effect that pushes the value lives further down, next to the session
  // info fetch it also depends on.
  const { setCwd: setWorkspaceCwd } = useWorkspace();
  useEffect(() => {
    fetch("/api/pi/chat/default-directory")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { path?: string; name?: string } | null) => {
        if (data?.path) setDefaultCwd({ path: data.path, name: data.name || data.path });
      })
      .catch(() => setDefaultCwd(null));
  }, []);
  const [selectedModel, setSelectedModel] = useState(
    () => window.localStorage.getItem("pi-web-switch:chat-model") ?? "",
  );
  const [selectedThinking, setSelectedThinking] = useState(
    () => window.localStorage.getItem("pi-web-switch:chat-thinking") ?? "",
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [activeModelProviderId, setActiveModelProviderId] = useState<
    string | null
  >(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const [editError, setEditError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // Live pi activity for the in-flight turn: thinking / tool work / responding.
  const [runStatus, setRunStatus] = useState<{
    kind: "starting" | "thinking" | "tool" | "responding";
    toolName?: string;
  } | null>(null);
  // Session usage panel (floating, right side): tokens, cache, context share.
  const [sessionUsage, setSessionUsage] = useState<SessionUsage | null>(null);
  // Session meta panel (below the usage panel): ids + working directory.
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(true);
  const hasFinderApi = typeof window !== "undefined" && !!window.piAPI?.openInFinder;
  const copyField = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1400);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };
  // Live steps for the in-flight turn (thinking / tool calls / tool results).
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  // Model / thinking level the opened session was last run with. Applied once
  // the model list has loaded, so reopening a conversation restores the model
  // it actually used instead of the last globally picked one.
  const [sessionModelState, setSessionModelState] = useState<SessionHistory["model"] | null>(null);
  const restoredModelSessionId = useRef<string | null>(null);
  const [runStepOpenOverrides, setRunStepOpenOverrides] = useState<Record<number, boolean>>({});
  const defaultModelRef =
    settings?.defaultProvider && settings.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : "";
  const customProviderIds = useMemo(
    () =>
      new Set(
        allProviders
          .filter((provider) => provider.type === "custom")
          .map((provider) => provider.id),
      ),
    [allProviders],
  );
  const codexProviderAvailable = allProviders.some(
    (provider) => provider.id === "openai-codex" && provider.hasAuth,
  );
  const selectableModels = useMemo(() => {
    const enabled = new Set(settings?.enabledModels ?? []);
    return allModels.filter(
      (model) =>
        enabled.has(`${model.providerId}/${model.id}`) ||
        `${model.providerId}/${model.id}` === defaultModelRef ||
        customProviderIds.has(model.providerId) ||
        (codexProviderAvailable && model.providerId === "openai-codex"),
    );
  }, [
    allModels,
    codexProviderAvailable,
    customProviderIds,
    defaultModelRef,
    settings?.enabledModels,
  ]);
  const modelGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; models: typeof selectableModels }
    >();
    selectableModels.forEach((model) => {
      const group = groups.get(model.providerId) ?? {
        id: model.providerId,
        name: model.providerName,
        models: [],
      };
      group.models.push(model);
      groups.set(model.providerId, group);
    });
    return [...groups.values()];
  }, [selectableModels]);
  const selectedModelInfo = selectableModels.find(
    (model) => `${model.providerId}/${model.id}` === selectedModel,
  );
  const effectiveModelInfo =
    selectedModelInfo ??
    allModels.find(
      (model) => `${model.providerId}/${model.id}` === defaultModelRef,
    );
  const supportedThinkingOptions = useMemo(() => {
    if (effectiveModelInfo?.providerId !== "openai-codex") {
      return STANDARD_THINKING_OPTIONS;
    }

    return THINKING_OPTIONS.filter(([level]) => {
      if (level === "") return true;
      if (!effectiveModelInfo?.reasoning) return level === "off";

      const mappedLevel =
        effectiveModelInfo.thinkingLevelMap?.[level as ThinkingLevel];
      if (mappedLevel === null) return false;
      return (
        (level !== "xhigh" && level !== "max") || mappedLevel !== undefined
      );
    });
  }, [effectiveModelInfo]);
  const activeModelGroup =
    modelGroups.find((group) => group.id === activeModelProviderId) ??
    modelGroups[0];
  const displayItems = useMemo(
    () =>
      messages.reduce<
        (
          | { type: "message"; message: Message }
          | { type: "tools"; count: number }
        )[]
      >((items, message) => {
        if (message.kind === "tool" && message.role === "assistant") {
          const previous = items.at(-1);
          if (previous?.type === "tools") previous.count++;
          else items.push({ type: "tools", count: 1 });
        } else items.push({ type: "message", message });
        return items;
      }, []),
    [messages],
  );
  // Whether the view was pinned to the latest message *before* the update being
  // rendered. Read during the scroll event, i.e. from the user's last
  // deliberate scroll, because by the time the layout effect runs the new text
  // has already been laid out and every position looks scrolled-up.
  const followingLatest = useRef(true);
  const updateScrollToBottomVisibility = () => {
    const container = messagesRef.current;
    if (!container) return;
    const away = distanceFromBottom(container) > AT_BOTTOM_SLACK_PX;
    followingLatest.current = !away;
    setShowScrollToBottom(away);
  };
  const scrollToBottom = () => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    followingLatest.current = true;
    setShowScrollToBottom(false);
  };

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;

    // The ceiling lives in CSS (.codex-composer textarea) so the two cannot
    // drift apart; this only measures what the content needs below it.
    const maxHeight = parseFloat(getComputedStyle(textarea).maxHeight) || 280;
    textarea.style.height = "auto";
    const height = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt]);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (scrollToLatestAfterHistory.current && !loadingHistory) {
      if (container) container.scrollTop = container.scrollHeight;
      scrollToLatestAfterHistory.current = false;
      followingLatest.current = true;
      setShowScrollToBottom(false);
      return;
    }
    // Follow a streaming answer while the user is reading the latest message.
    // Without this the new text grew downward out of view and the reader had to
    // chase it with the scrollbar, which is what made long answers feel worse
    // than they were. Scrolling someone who has deliberately moved up is the
    // worse failure, so following stops the moment they leave the bottom, and
    // `jump to bottom` is how they opt back in.
    if (container && followingLatest.current) {
      // Assigning scrollTop, not scrollTo({behavior:"smooth"}): a smooth scroll
      // restarted on every repaint never arrives.
      container.scrollTop = container.scrollHeight;
      setShowScrollToBottom(false);
      return;
    }
    updateScrollToBottomVisibility();
  }, [loadingHistory, messages]);

  // Restore the session's own model / thinking level once the model list is
  // available. Runs once per opened session so a manual pick afterwards sticks.
  useEffect(() => {
    if (!sessionId || !sessionModelState || selectableModels.length === 0) return;
    if (restoredModelSessionId.current === sessionId) return;
    restoredModelSessionId.current = sessionId;
    const { providerId, modelId, thinkingLevel } = sessionModelState;
    if (providerId && modelId) {
      const ref = `${providerId}/${modelId}`;
      const available = selectableModels.some((model) => `${model.providerId}/${model.id}` === ref);
      // The provider may have been removed since the session ran. Falling back
      // to the default model is clearer than leaving the previous session's
      // pick on screen, which would misrepresent this conversation.
      const next = available ? ref : defaultModelRef;
      if (next) {
        setSelectedModel(next);
        window.localStorage.setItem("pi-web-switch:chat-model", next);
      }
    }
    if (thinkingLevel) {
      setSelectedThinking(thinkingLevel);
      window.localStorage.setItem("pi-web-switch:chat-thinking", thinkingLevel);
    }
  }, [defaultModelRef, sessionId, sessionModelState, selectableModels]);

  useEffect(() => {
    if (
      selectedModel &&
      selectableModels.some(
        (model) => `${model.providerId}/${model.id}` === selectedModel,
      )
    )
      return;
    const fallback =
      defaultModelRef ||
      (selectableModels[0]
        ? `${selectableModels[0].providerId}/${selectableModels[0].id}`
        : "");
    setSelectedModel(fallback);
  }, [defaultModelRef, selectableModels, selectedModel]);

  useEffect(() => {
    if (supportedThinkingOptions.some(([value]) => value === selectedThinking))
      return;
    const fallback = supportedThinkingOptions[0]?.[0] ?? "";
    setSelectedThinking(fallback);
    window.localStorage.setItem("pi-web-switch:chat-thinking", fallback);
  }, [selectedThinking, supportedThinkingOptions]);

  useEffect(() => {
    setRunStepOpenOverrides({});
  }, [settings?.expandRunSteps]);

  useEffect(() => {
    if (
      activeModelProviderId &&
      modelGroups.some((group) => group.id === activeModelProviderId)
    )
      return;
    const selectedProviderId = selectedModel.split("/")[0];
    setActiveModelProviderId(
      modelGroups.find((group) => group.id === selectedProviderId)?.id ??
        modelGroups[0]?.id ??
        null,
    );
  }, [activeModelProviderId, modelGroups, selectedModel]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node))
        setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (preserveMessagesAfterCreate.current) {
      preserveMessagesAfterCreate.current = false;
      return;
    }
    setMessages([]);
    setPrompt("");
    setHistoryError("");
    setSessionModelState(null);
    if (!sessionId) {
      scrollToLatestAfterHistory.current = false;
      restoredModelSessionId.current = null;
      return;
    }
    const controller = new AbortController();
    scrollToLatestAfterHistory.current = true;
    setLoadingHistory(true);
    fetch(`/api/pi/session-history?id=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((history: SessionHistory) => {
        setMessages(history.messages);
        setSessionModelState(history.model ?? null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setHistoryError("加载会话历史失败");
      })
      .finally(() => setLoadingHistory(false));
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return;
    fetch("/api/pi/sessions")
      .then((res) => (res.ok ? res.json() : []))
      .then((groups: ProjectGroup[]) => setProjects(groups))
      .catch(() => setProjects([]));
  }, [sessionId]);

  // Which session the numbers on screen belong to. A reply for a session the
  // user has already navigated away from must not overwrite the new one's, and
  // the fetches below outlive the render that started them.
  const sessionMetaIdRef = useRef(sessionId);
  sessionMetaIdRef.current = sessionId;

  const loadSessionUsage = useCallback(() => {
    if (!sessionId) {
      setSessionUsage(null);
      return;
    }
    const stale = () => sessionMetaIdRef.current !== sessionId;
    fetch(`/api/pi/session-usage?session=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionUsage | null) => {
        if (!stale()) setSessionUsage(data && data.sessionId ? data : null);
      })
      .catch(() => { if (!stale()) setSessionUsage(null); });
  }, [sessionId]);

  const loadSessionInfo = useCallback(() => {
    if (!sessionId) {
      setSessionInfo(null);
      return;
    }
    const stale = () => sessionMetaIdRef.current !== sessionId;
    fetch(`/api/pi/session-info?session=${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionInfo | null) => {
        if (!stale()) setSessionInfo(data && data.sessionId ? data : null);
      })
      .catch(() => { if (!stale()) setSessionInfo(null); });
  }, [sessionId]);

  // Usage grows with every turn, so it repeats while one is running. A turn can
  // run for minutes with the window tucked away in the menu bar, so the repeat
  // pauses while hidden. usePolling reads its task through a ref and therefore
  // does not restart when the session changes — the effect covers that, plus
  // the final read once `running` goes false. The two overlap for one tick when
  // a turn starts; two reads of one session file is cheaper than the
  // bookkeeping to avoid them.
  usePolling(loadSessionUsage, 4000, Boolean(sessionId) && running);
  useEffect(() => {
    loadSessionUsage();
  }, [loadSessionUsage, running]);

  // Session meta does not grow: the working directory, the file path and the
  // intercom id are all fixed when the session file is created. Polling it
  // alongside usage therefore spent a request and a session-list scan every 4
  // seconds to re-learn constants, on the same single-threaded server that was
  // relaying the answer being typed on screen. The effect below fetches it per
  // session id instead.
  //
  // The repeat survives for one case: a session created by the run that is
  // still streaming. Its id reaches the URL as soon as pi reports it, which can
  // be before the file is visible through the endpoint's own 5-second list
  // cache, and the answer then comes back without a filePath. Retrying until
  // one arrives is what keeps the tool panel off the wrong directory for a
  // freshly created chat. It stops on the first complete answer, so opening an
  // existing session costs two requests — the effect's and the one usePolling
  // fires on enable — and then nothing.
  const resolvedInfoId = sessionInfo?.filePath ? sessionInfo.sessionId : undefined;
  usePolling(loadSessionInfo, 4000, Boolean(sessionId) && resolvedInfoId !== sessionId);
  useEffect(() => {
    loadSessionInfo();
  }, [loadSessionInfo]);

  // Point the tool panel at the directory this chat actually runs in. Opening a
  // session from the sidebar only sets ?session=, leaving projectPath empty, so
  // without the session's own recorded cwd the panel stayed on the default
  // directory no matter which project was opened. The id check drops the
  // previous session's cwd during the switch instead of showing it briefly.
  const openedSessionCwd =
    sessionInfo && sessionInfo.sessionId === sessionId ? sessionInfo.cwd : undefined;
  useEffect(() => {
    setWorkspaceCwd(
      resolveWorkspaceCwd({
        sessionPending: Boolean(sessionId),
        sessionCwd: openedSessionCwd,
        projectPath,
        defaultCwd: defaultCwd?.path,
      }),
    );
  }, [sessionId, openedSessionCwd, projectPath, defaultCwd, setWorkspaceCwd]);

  // pi binds a session to the directory it was started in, so the composer's
  // directory control is a picker only while the session does not exist yet.
  // Once it does, it reports where the session actually runs.
  const cwdLocked = Boolean(sessionId);
  const activeCwdPath = openedSessionCwd ?? projectPath ?? "";
  const activeCwdLabel =
    (activeCwdPath &&
      (projects.find((project) => project.projectPath === activeCwdPath)?.projectName ||
        activeCwdPath.split("/").filter(Boolean).pop() ||
        activeCwdPath)) ||
    defaultCwd?.name ||
    "默认目录";

  // ── Streaming answer buffer ──────────────────────────────────────────────
  //
  // pi emits one `delta` event per token, and committing each one to state
  // repainted the whole pane. Because every repaint re-parses the growing turn
  // through remark (~1ms per 550 chars), a long answer got quadratically
  // slower: a 12k-char turn cost ~2.7s of parsing across 300 deltas, with
  // individual deltas blocking the window for 38ms. The buffer coalesces them
  // onto an interval that scales with the length of the answer; the timing
  // rules live in stream-buffer.ts, where they are unit-tested against a fake
  // clock. Appending to the last message is this page's own concern, so that
  // stays here.
  const answerBufferRef = useRef<StreamBuffer | null>(null);
  if (!answerBufferRef.current) {
    answerBufferRef.current = createStreamBuffer((chunk) =>
      setMessages((items) =>
        items.map((item, index) =>
          index === items.length - 1 ? { ...item, text: item.text + chunk } : item,
        ),
      ),
    );
  }
  const answerBuffer = answerBufferRef.current;

  // A pending flush must not outlive the page: navigating away mid-stream
  // would otherwise fire setMessages on an unmounted component.
  useEffect(() => () => answerBuffer.drop(), [answerBuffer]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // A Chinese IME may have emitted the fullwidth ／ (U+FF0F) for the slash
    // key; pi only recognizes halfwidth commands, so a leading one is
    // normalized here rather than sent to be answered as ordinary text.
    const text = prompt.trim().replace(/^／/, "/");
    if (!text || running || (customProject && !projectPath.trim())) return;
    const requestedSessionId = sessionId ?? `web-${crypto.randomUUID()}`;
    setActiveRunSessionId(requestedSessionId);
    // This run's answer starts empty, so the flush interval starts at its floor
    // again rather than inheriting the previous turn's length.
    answerBuffer.reset();
    setMessages((items) => [
      ...items,
      { id: `local-${crypto.randomUUID()}`, role: "user", text },
      { role: "assistant", text: "" },
    ]);
    setPrompt("");
    setRunning(true);
    setRunStatus({ kind: "starting" });
    setRunSteps([]);
    setRunStepOpenOverrides({});
    try {
      const res = await fetch("/api/pi/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          sessionId: requestedSessionId,
          projectPath: projectPath || undefined,
          model: selectedModel || undefined,
          thinking: selectedThinking || undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const eventType = raw.match(/^event: (.+)$/m)?.[1];
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (!eventType || !data) continue;
          const payload = JSON.parse(data);
          if (eventType === "delta") answerBuffer.push(payload);
          if (eventType === "status") setRunStatus(payload);
          if (eventType === "step")
            setRunSteps((steps) => [...steps, payload as RunStep]);
          if (eventType === "done") {
            preserveMessagesAfterCreate.current = true;
            setSearchParams({ session: payload.sessionId }, { replace: true });
            window.dispatchEvent(new Event("pi-session-created"));
          }
          if (eventType === "error") failure = payload;
        }
      }
      // Commit whatever the last interval did not cover, before any of the
      // endings below rewrite this message.
      answerBuffer.flush();
      if (failure && failure !== "generation stopped") throw new Error(failure);
      if (failure === "generation stopped")
        setMessages((items) =>
          items.map((item, index) =>
            index === items.length - 1 && !item.text
              ? { ...item, text: "已停止生成。" }
              : item,
          ),
        );
    } catch (error) {
      // The message is replaced wholesale, so a pending tail would only flash
      // in and vanish. Drop it with the timer.
      answerBuffer.drop();
      setMessages((items) =>
        items.map((item, index) =>
          index === items.length - 1
            ? {
                ...item,
                text: `Error: ${error instanceof Error ? error.message : "Request failed"}`,
              }
            : item,
        ),
      );
    } finally {
      answerBuffer.drop();
      setRunning(false);
      setRunStatus(null);
      setActiveRunSessionId(null);
    }
  };

  const stop = async () => {
    if (!activeRunSessionId) return;
    await fetch("/api/pi/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeRunSessionId }),
    });
  };
  const copyMessage = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopiedMessageId(messageId);
    window.setTimeout(
      () => setCopiedMessageId((current) => current === messageId ? null : current),
      1500,
    );
  };
  const startEditingMessage = (message: Message) => {
    if (!message.id) return;
    setEditingMessageId(message.id);
    setEditingText(message.text);
    setEditError("");
  };
  const saveEditedMessage = async (message: Message) => {
    const nextText = editingText.trim();
    if (!message.id || !nextText || savingMessage) return;
    setSavingMessage(true);
    try {
      if (sessionId && !message.id.startsWith("local-")) {
        const response = await fetch("/api/pi/session-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, messageId: message.id, text: nextText }),
        });
        const result = (await response.json()) as { success?: boolean };
        if (!response.ok || !result.success) throw new Error("save failed");
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === message.id ? { ...item, text: nextText } : item,
        ),
      );
      setEditingMessageId(null);
    } catch {
      setEditError(t("chat.save_failed"));
    } finally {
      setSavingMessage(false);
    }
  };
  const chooseDirectory = async () => {
    setChoosingDirectory(true);
    try {
      const response = await fetch("/api/pi/chat/select-directory", {
        method: "POST",
      });
      const result = (await response.json()) as { path?: string | null };
      if (result.path) setProjectPath(result.path);
    } finally {
      setChoosingDirectory(false);
    }
  };
  const chooseModel = (model: string) => {
    setSelectedModel(model);
    window.localStorage.setItem("pi-web-switch:chat-model", model);
    setModelMenuOpen(false);
  };

  return (
    <section className="codex-chat">
      <div className="codex-chat-title">
        <MessageSquare className="h-4 w-4" />
        <span>Pi</span>
        <small>{sessionId ? "继续会话" : "本地工作区"}</small>
      </div>
      <div className="codex-message-pane">
        <div className="codex-message-column">
        <div
          ref={messagesRef}
          onScroll={updateScrollToBottomVisibility}
          className="codex-messages"
        >
          {loadingHistory && (
            <div className="codex-history-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在加载会话历史…
            </div>
          )}
          {historyError && (
            <div className="codex-history-error">{historyError}</div>
          )}
          {!loadingHistory && !historyError && messages.length === 0 && (
            <div className="codex-empty">
              <div className="codex-empty-mark">π</div>
              <h1>今天想做什么？</h1>
              <p>选择项目目录后开始对话，新会话会归入该项目。</p>
              <label className="codex-project-picker">
                <Folder className="h-4 w-4" />
                <span>项目目录</span>
                <select
                  value={customProject ? "__custom__" : projectPath}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustomProject(value === "__custom__");
                    setProjectPath(value === "__custom__" ? "" : value);
                    // The URL's ?project= seed only applies on arrival; once
                    // the user picks manually, drop it so a reload can't
                    // resurrect the old directory.
                    if (searchParams.has("project")) {
                      const next = new URLSearchParams(searchParams);
                      next.delete("project");
                      setSearchParams(next, { replace: true });
                    }
                  }}
                >
                  <option value="">
                    {defaultCwd ? `默认目录（${defaultCwd.name}）` : "默认目录"}
                  </option>
                  {projects.map((project) => (
                    <option
                      key={project.projectPath}
                      value={project.projectPath}
                    >
                      {project.projectName}
                    </option>
                  ))}
                  <option value="__custom__">自定义目录…</option>
                </select>
              </label>
              {customProject && (
                <div className="codex-custom-directory">
                  <input
                    className="codex-custom-project"
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.target.value)}
                    placeholder="选择或输入本地绝对路径"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={chooseDirectory}
                    disabled={choosingDirectory}
                  >
                    {choosingDirectory ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="h-4 w-4" />
                    )}
                    选择目录…
                  </button>
                </div>
              )}
            </div>
          )}
          {displayItems.map((item, index) =>
            item.type === "tools" ? (
              <details key={index} className="codex-tool-group">
                <summary>已完成 {item.count} 个工作步骤</summary>
                <p>工具调用内容已折叠，可按需展开查看。</p>
              </details>
            ) : (
              <div
                key={index}
                className={cn(
                  "codex-message",
                  item.message.role === "user" && "is-user",
                )}
              >
                <div className="codex-message-avatar">
                  {item.message.role === "user" ? "你" : "π"}
                </div>
                {item.message.role === "user" &&
                item.message.id &&
                editingMessageId === item.message.id ? (
                  <div className="codex-message-editor">
                    <textarea
                      value={editingText}
                      autoFocus
                      rows={Math.min(
                        10,
                        Math.max(2, editingText.split("\n").length),
                      )}
                      onChange={(event) => setEditingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingMessageId(null);
                        }
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          void saveEditedMessage(item.message);
                        }
                      }}
                    />
                    {editError && (
                      <p className="codex-message-edit-error">{editError}</p>
                    )}
                    <div className="codex-message-edit-actions">
                      <button
                        type="button"
                        onClick={() => setEditingMessageId(null)}
                        disabled={savingMessage}
                      >
                        {t("chat.cancel")}
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => void saveEditedMessage(item.message)}
                        disabled={savingMessage || !editingText.trim()}
                      >
                        {savingMessage ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {t("chat.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="codex-message-body">
                    <MessageText text={item.message.text} />
                    {item.message.role === "user" && item.message.id && (
                      <div className="codex-message-actions">
                        <button
                          type="button"
                          title={t("chat.copy")}
                          aria-label={t("chat.copy")}
                          onClick={() =>
                            void copyMessage(
                              item.message.id!,
                              item.message.text,
                            )
                          }
                        >
                          {copiedMessageId === item.message.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          title={t("chat.edit")}
                          aria-label={t("chat.edit")}
                          disabled={running}
                          onClick={() => startEditingMessage(item.message)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {runSteps.length > 0 && (
            <div className="codex-run-steps">
              {runSteps.map((step, stepIndex) => (
                <details
                  key={stepIndex}
                  open={runStepOpenOverrides[stepIndex] ?? (settings?.expandRunSteps ?? true)}
                  // `open` is read here rather than inside the updater because
                  // React nulls `currentTarget` the moment the handler returns,
                  // while the updater runs later, when the queue is processed.
                  // That deferral is invisible while the fiber is idle — React
                  // then evaluates the updater eagerly — so this looked fine in
                  // manual use and threw during a streamed answer, where the
                  // constant delta commits keep an update pending: `Cannot read
                  // properties of null (reading 'open')`, which unmounted the
                  // whole chat page mid-answer.
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setRunStepOpenOverrides((previous) => ({ ...previous, [stepIndex]: isOpen }));
                  }}
                  className={cn(
                    "codex-run-step",
                    step.kind === "thinking" && "is-thinking",
                    step.isError && "is-error",
                  )}
                >
                  <summary>
                    {step.kind === "thinking" ? (
                      <>
                        <BrainCircuit className="h-3.5 w-3.5" />
                        <span>{t("chat.step_thinking")}</span>
                      </>
                    ) : step.kind === "tool" ? (
                      <>
                        <Wrench className="h-3.5 w-3.5" />
                        <span>
                          {t("chat.step_tool", step.toolName ?? "tool")}
                        </span>
                      </>
                    ) : (
                      <>
                        {step.isError ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {t("chat.step_result", step.toolName ?? "tool")}
                        </span>
                      </>
                    )}
                  </summary>
                  <pre>{step.text || step.args || ""}</pre>
                </details>
              ))}
            </div>
          )}
          {running && runStatus && runStatus.kind !== "responding" && (
            <div className="codex-run-status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                {runStatus.kind === "thinking"
                  ? t("chat.status_thinking")
                  : runStatus.kind === "tool"
                    ? runStatus.toolName
                      ? t("chat.status_tool_named", runStatus.toolName)
                      : t("chat.status_working")
                    : t("chat.status_starting")}
              </span>
            </div>
          )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            className="codex-scroll-bottom"
            onClick={scrollToBottom}
            aria-label="滚动到最新消息"
            title="回到底部"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
        </div>
        {(sessionUsage || sessionInfo) && (
          <div className="codex-side-panels">
            {sessionUsage && (
              <aside
                className={cn("codex-usage-panel", !usageOpen && "is-collapsed")}
              >
            <button
              type="button"
              className="codex-usage-toggle"
              onClick={() => setUsageOpen((open) => !open)}
              title={
                usageOpen ? t("chat.usage_collapse") : t("chat.usage_expand")
              }
            >
              <Gauge className="h-3.5 w-3.5" />
              {usageOpen && <span>{t("chat.usage_title")}</span>}
              {usageOpen && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </button>
            {usageOpen && (
              <div className="codex-usage-body">
                <div className="codex-usage-row is-model">
                  <span>{t("chat.usage_model")}</span>
                  <strong title={`${sessionUsage.providerId ?? ""}/${sessionUsage.modelId ?? ""}`}>
                    {sessionUsage.modelId ?? "—"}
                  </strong>
                </div>
                {sessionUsage.providerId && (
                  <div className="codex-usage-row">
                    <span>{t("chat.usage_provider")}</span>
                    <strong>{sessionUsage.providerId}</strong>
                  </div>
                )}
                {sessionUsage.contextWindow ? (
                  <div className="codex-usage-context">
                    <div className="codex-usage-row">
                      <span>{t("chat.usage_context")}</span>
                      <strong>
                        {Math.min(
                          100,
                          Math.round(
                            (sessionUsage.lastContextTokens /
                              sessionUsage.contextWindow) *
                              100,
                          ),
                        )}
                        %
                      </strong>
                    </div>
                    <div className="codex-usage-track">
                      <span
                        style={{
                          width: `${Math.min(100, (sessionUsage.lastContextTokens / sessionUsage.contextWindow) * 100)}%`,
                        }}
                      />
                    </div>
                    <small>
                      {formatTokens(sessionUsage.lastContextTokens)} /{" "}
                      {formatTokens(sessionUsage.contextWindow)}
                    </small>
                  </div>
                ) : null}
                <div className="codex-usage-row">
                  <span>{t("chat.usage_tokens")}</span>
                  <strong>{formatTokens(sessionUsage.totalTokens)}</strong>
                </div>
                <div className="codex-usage-row">
                  <span>{t("chat.usage_input")}</span>
                  <strong>{formatTokens(sessionUsage.totalInput)}</strong>
                </div>
                <div className="codex-usage-row">
                  <span>{t("chat.usage_output")}</span>
                  <strong>{formatTokens(sessionUsage.totalOutput)}</strong>
                </div>
                <div className="codex-usage-row">
                  <span>{t("chat.usage_cache")}</span>
                  <strong>
                    {formatTokens(sessionUsage.totalCacheRead)} ·{" "}
                    {sessionUsage.cacheHitRate.toFixed(1)}%
                  </strong>
                </div>
                <div className="codex-usage-row">
                  <span>{t("chat.usage_requests")}</span>
                  <strong>{sessionUsage.requests}</strong>
                </div>
                <div className="codex-usage-row is-cost">
                  <span>{t("chat.usage_cost")}</span>
                  <strong>${sessionUsage.totalCost.toFixed(4)}</strong>
                </div>
                {sessionId && (
                  <CompactButton
                    sessionId={sessionId}
                    onCompacted={() => {
                      // Context usage drops once older turns become a summary.
                      // The transcript itself is unchanged on disk (compaction
                      // appends an entry; it does not rewrite history), so only
                      // the numbers need re-reading.
                      loadSessionUsage();
                    }}
                  />
                )}
              </div>
            )}
          </aside>
            )}
            {sessionInfo && (
              <aside className="codex-session-meta">
                <div className="codex-meta-row">
                  <span>session-id</span>
                  <code title={sessionInfo.sessionId}>
                    {sessionInfo.sessionId}
                  </code>
                  <button
                    type="button"
                    title="复制 session-id"
                    onClick={() => copyField("session-id", sessionInfo.sessionId)}
                  >
                    {copiedField === "session-id" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
                <div className="codex-meta-row">
                  <span>intercom-id</span>
                  <code title={sessionInfo.intercomId}>
                    {sessionInfo.intercomId}
                  </code>
                  <button
                    type="button"
                    title="复制 intercom-id"
                    onClick={() => copyField("intercom-id", sessionInfo.intercomId)}
                  >
                    {copiedField === "intercom-id" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
                {(sessionInfo.cwd || projectPath.trim()) && (
                  <div className="codex-meta-actions">
                    <button
                      type="button"
                      title={sessionInfo.cwd || projectPath}
                      onClick={() =>
                        copyField("cwd", sessionInfo.cwd || projectPath.trim())
                      }
                    >
                      <Folder className="h-3 w-3" />
                      {copiedField === "cwd" ? "已复制" : "复制目录"}
                    </button>
                    {hasFinderApi && (
                      <button
                        type="button"
                        title={sessionInfo.cwd || projectPath}
                        onClick={() =>
                          window.piAPI?.openInFinder?.(
                            sessionInfo.cwd || projectPath.trim(),
                          )
                        }
                      >
                        <FolderOpen className="h-3 w-3" />
                        Finder 打开
                      </button>
                    )}
                  </div>
                )}
              </aside>
            )}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="codex-composer">
        {slashOpen && !running && (
          <SlashMenu
            commands={slashMatches}
            loading={slashLoading}
            error={slashError}
            query={slashToken ?? ""}
            activeIndex={slashIndex}
            onHover={setSlashIndex}
            onPick={pickSlash}
          />
        )}
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            // Typing again re-arms the menu after a pick.
            setSlashDismissed(false);
          }}
          onKeyDown={(event) => {
            // The "/" menu owns the arrows, Tab, Enter and Escape while open.
            if (slashOpen && slashMatches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSlashIndex((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)) {
                event.preventDefault();
                const picked = slashMatches[slashIndex] ?? slashMatches[0];
                if (picked) pickSlash(picked);
                return;
              }
            }
            if (event.key === "Escape" && slashOpen) {
              event.preventDefault();
              setSlashDismissed(true);
              return;
            }
            // Enter sends; Shift+Enter inserts a newline. IME composition
            // (e.g. Chinese input) must not be interrupted by a send.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit(event);
            }
          }}
          placeholder={t("chat.input_placeholder")}
          rows={1}
        />
        {/* One control row: what the turn runs with on the left, run controls on
            the right. The directory is a picker only until the session exists,
            because pi binds a session to the directory it was started in. */}
        <div className="codex-composer-row">
          <label
            className="codex-cwd-picker"
            title={
              cwdLocked
                ? "会话已绑定此目录，新建对话可更换"
                : "选择本次对话的工作目录"
            }
          >
            <Folder className="h-3.5 w-3.5" />
            {cwdLocked ? (
              <span className="truncate">{activeCwdLabel}</span>
            ) : (
              <select
                value={customProject ? "__custom__" : projectPath}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomProject(value === "__custom__");
                  setProjectPath(value === "__custom__" ? "" : value);
                  if (searchParams.has("project")) {
                    const next = new URLSearchParams(searchParams);
                    next.delete("project");
                    setSearchParams(next, { replace: true });
                  }
                }}
              >
                <option value="">
                  {defaultCwd ? `默认目录（${defaultCwd.name}）` : "默认目录"}
                </option>
                {projects.map((project) => (
                  <option key={project.projectPath} value={project.projectPath}>
                    {project.projectName}
                  </option>
                ))}
                <option value="__custom__">自定义目录…</option>
              </select>
            )}
          </label>
          <div ref={modelPickerRef} className="codex-model-picker">
            <button
              type="button"
              className="codex-model-trigger"
              disabled={running || selectableModels.length === 0}
              onClick={() => {
                setActiveModelProviderId(
                  selectedModelInfo?.providerId ?? modelGroups[0]?.id ?? null,
                );
                setModelMenuOpen((open) => !open);
              }}
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="truncate">
                {selectedModelInfo
                  ? `${selectedModelInfo.providerName} / ${selectedModelInfo.name || selectedModelInfo.id}`
                  : "Pi 默认模型"}
              </span>
              <ChevronDown
                className={cn("h-3.5 w-3.5", modelMenuOpen && "rotate-180")}
              />
            </button>
            {modelMenuOpen && (
              <div className="codex-model-menu">
                <div className="codex-provider-list">
                  <button
                    type="button"
                    className={cn(
                      "codex-provider-option",
                      !selectedModel && "is-selected",
                    )}
                    onClick={() => chooseModel("")}
                  >
                    <span>Pi 默认模型</span>
                    {!selectedModel && <Check className="h-3.5 w-3.5" />}
                  </button>
                  {modelGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={cn(
                        "codex-provider-option",
                        activeModelGroup?.id === group.id && "is-active",
                      )}
                      onMouseEnter={() => setActiveModelProviderId(group.id)}
                      onClick={() => setActiveModelProviderId(group.id)}
                    >
                      <span className="truncate">{group.name}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
                <div className="codex-provider-models">
                  {activeModelGroup && (
                    <>
                      <p>{activeModelGroup.name}</p>
                      {activeModelGroup.models.map((model) => {
                        const value = `${model.providerId}/${model.id}`;
                        return (
                          <button
                            key={value}
                            type="button"
                            className={cn(
                              "codex-provider-model",
                              selectedModel === value && "is-selected",
                            )}
                            onClick={() => chooseModel(value)}
                          >
                            <span className="truncate">
                              {model.name || model.id}
                            </span>
                            {selectedModel === value && (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                  <Link to="/providers" onClick={() => setModelMenuOpen(false)}>
                    管理模型
                  </Link>
                </div>
              </div>
            )}
          </div>
          <label className="codex-thinking-picker" title="选择本次对话的思考深度">
            <BrainCircuit className="h-3.5 w-3.5" />
            <select
              value={selectedThinking}
              disabled={running}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedThinking(value);
                window.localStorage.setItem("pi-web-switch:chat-thinking", value);
              }}
            >
              {supportedThinkingOptions.map(([value, label]) => (
                <option key={value || "default"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="codex-composer-actions">
            {/* Stop only exists while a turn is running; showing a permanently
                disabled square next to send just adds a dead control. */}
            {running && (
              <button
                type="button"
                className="codex-stop"
                aria-label="停止生成"
                onClick={stop}
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            )}
            <button
              className="codex-send"
              aria-label="Send message"
              disabled={
                running || !prompt.trim() || (customProject && !projectPath.trim())
              }
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </form>
      <p className="codex-disclaimer">Pi 可能会出错，请核查重要信息。</p>
    </section>
  );
}

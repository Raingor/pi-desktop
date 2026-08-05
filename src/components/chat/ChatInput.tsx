// ChatInput — message input bar with model selector, tool preset, and send controls.
// Ported and simplified from pi-web's components/ChatInput.tsx.

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, forwardRef, useImperativeHandle } from "react";
import type { AttachedImage, ChatInputHandle, ModelEntry, SlashCommandInfo, QueuedMessages } from "@/types/chat";
import { useTranslation } from "@/lib/i18n";

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: ModelEntry[];
  modelError?: string | null;
  onModelChange: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  thinkingLevel: string;
  onThinkingLevelChange: (level: any) => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => void;
  onBuiltinCommand?: (text: string) => Promise<{ handled: boolean; message?: string; error?: string }>;
  inputHistory?: string[];
  draftKey?: string;
  cwd?: string;
}

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 200;
const DRAFT_STORAGE_PREFIX = "pi-chat-draft:";

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(props, ref) {
  const {
    onSend, onAbort, onSteer, onFollowUp, isStreaming,
    model, isAutoModelSelection, modelNames, modelList, modelError, onModelChange,
    onCompact, isCompacting, compactError,
    thinkingLevel, onThinkingLevelChange,
    retryInfo, queuedMessages, onRecallQueue,
    slashCommands, slashCommandsLoading, onLoadSlashCommands,
    onBuiltinCommand, inputHistory, draftKey, cwd,
  } = props;

  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;

  // Focus search input when model menu opens
  useEffect(() => {
    if (showModelMenu) {
      setModelSearchQuery("");
      requestAnimationFrame(() => {
        modelSearchInputRef.current?.focus();
      });
    }
  }, [showModelMenu]);

  // ─── Imperative Handle ─────────────────────────────────

  useImperativeHandle(ref, () => ({
    insertText: (t: string) => {
      setText((prev) => prev + t);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
      });
    },
    insertIfEmpty: (content: string) => {
      setText((prev) => (prev.trim() === "" ? content : prev));
      textareaRef.current?.focus();
    },
    prependText: (t: string) => {
      setText((prev) => t + (prev ? "\n\n" + prev : ""));
      textareaRef.current?.focus();
    },
    addImages: (files: File[]) => {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (base64) {
            setAttachedImages((prev) => [...prev, {
              data: base64,
              mimeType: file.type,
              previewUrl: dataUrl,
            }]);
          }
        };
        reader.readAsDataURL(file);
      }
    },
  }), []);

  // ─── Draft Persistence ─────────────────────────────────

  useEffect(() => {
    if (draftKey) {
      const saved = localStorage.getItem(DRAFT_STORAGE_PREFIX + draftKey);
      if (saved !== null) setText(saved);
    }
  }, [draftKey]);

  useEffect(() => {
    if (draftKey) {
      localStorage.setItem(DRAFT_STORAGE_PREFIX + draftKey, text);
    }
  }, [text, draftKey]);

  // ─── Auto-resize Textarea ──────────────────────────────

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [text]);

  // ─── Send ──────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !attachedImages.length) return;
    if (isStreaming) return;

    // Check for built-in slash commands
    if (onBuiltinCommand && trimmed.startsWith("/")) {
      const result = await onBuiltinCommand(trimmed);
      if (result.handled) {
        setText("");
        setAttachedImages([]);
        setHistoryIndex(-1);
        return;
      }
    }

    onSend(trimmed, attachedImages.length ? attachedImages : undefined);
    setText("");
    setAttachedImages([]);
    setHistoryIndex(-1);
  }, [text, attachedImages, isStreaming, onSend, onBuiltinCommand]);

  // ─── Keyboard Shortcuts ────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without shift)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isStreaming) {
        onSteer?.(text);
      } else {
        void handleSend();
      }
      return;
    }

    // Shift+Enter for new line (default behavior)

    // History navigation
    if (e.key === "ArrowUp" && !e.shiftKey && text === "" && inputHistory && inputHistory.length > 0) {
      e.preventDefault();
      const newIdx = historyIndex === -1 ? 0 : Math.min(historyIndex + 1, inputHistory.length - 1);
      setHistoryIndex(newIdx);
      setText(inputHistory[newIdx] ?? "");
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && historyIndex >= 0) {
      e.preventDefault();
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setText(newIdx === -1 ? "" : inputHistory?.[newIdx] ?? "");
      return;
    }

    // Slash command menu
    if (e.key === "/" && text === "") {
      setShowSlashMenu(true);
      if (onLoadSlashCommands) onLoadSlashCommands();
    }
    if (e.key === "Escape") {
      setShowSlashMenu(false);
      setShowModelMenu(false);
    }
  }, [text, isStreaming, historyIndex, inputHistory, onSteer, handleSend, onLoadSlashCommands]);

  // ─── Image Attach ──────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (ref && typeof ref === "object") {
      ref.current?.addImages(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [ref]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const images: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length > 0) {
      e.preventDefault();
      if (ref && typeof ref === "object") {
        ref.current?.addImages(images);
      }
    }
  }, [ref]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const removed = next.splice(index, 1)[0];
      if (removed?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }, []);

  // ─── Render ────────────────────────────────────────────

  const modelLabel = model
    ? modelNames?.[`${model.provider}:${model.modelId}`] ?? model.modelId
    : isAutoModelSelection
      ? t("chat.auto")
      : t("chat.no_model");

  return (
    <div style={{
      position: "relative",
      padding: "0 16px 12px 16px",
    }}>
      {/* Queue banner */}
      {queuedMessages && (queuedMessages.steering.length > 0 || queuedMessages.followUp.length > 0) && (
        <div style={{
          marginBottom: 8,
          padding: "6px 10px",
          borderRadius: 8,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span>
            {t("chat.steering_queued", String(queuedMessages.steering.length), String(queuedMessages.followUp.length))}
          </span>
          {onRecallQueue && (
            <button
              onClick={onRecallQueue}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {t("chat.recall")}
            </button>
          )}
        </div>
      )}

      {/* Compact banner */}
      {isCompacting && (
        <div style={{
          marginBottom: 8,
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(37,99,235,0.06)",
          border: "1px solid rgba(37,99,235,0.2)",
          fontSize: 12,
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t("chat.compacting")}
        </div>
      )}
      {compactError && (
        <div style={{
          marginBottom: 8,
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(239,68,68,0.06)",
          fontSize: 12,
          color: "#dc2626",
        }}>
          {t("chat.compaction_failed", compactError)}
        </div>
      )}
      {retryInfo && (
        <div style={{
          marginBottom: 8,
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(234,179,8,0.06)",
          fontSize: 12,
          color: "#d97706",
        }}>
          {t("chat.retrying", String(retryInfo.attempt), String(retryInfo.maxAttempts), retryInfo.errorMessage ? ": " + retryInfo.errorMessage : "")}
        </div>
      )}

      {/* Slash command dropdown */}
      {showSlashMenu && slashCommands && slashCommands.length > 0 && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 16,
          right: 16,
          maxHeight: 200,
          overflow: "auto",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          marginBottom: 4,
          zIndex: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}>
          {slashCommandsLoading && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>{t("chat.loading")}</div>
          )}
          {slashCommands.map((cmd) => (
            <button
              key={cmd.name}
              onClick={() => {
                setText(`/${cmd.name} `);
                setShowSlashMenu(false);
                textareaRef.current?.focus();
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 13,
                color: "var(--text)",
              }}
            >
              <span style={{ color: "var(--accent)" }}>/{cmd.name}</span>
              {cmd.description && (
                <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{cmd.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Model selector dropdown */}
      {showModelMenu && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 16,
          right: 16,
          maxHeight: 320,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          marginBottom: 6,
          zIndex: 20,
          minWidth: 280,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
        }}>
          {/* Search header */}
          <div style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--bg-panel)",
            borderRadius: "10px 10px 0 0",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={modelSearchInputRef}
              type="text"
              value={modelSearchQuery}
              onChange={(e) => setModelSearchQuery(e.target.value)}
              placeholder={t("chat.search_models")}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                color: "var(--text)",
                padding: 0,
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowModelMenu(false);
                }
              }}
            />
            {modelSearchQuery && (
              <button
                onClick={() => setModelSearchQuery("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Model list */}
          <div style={{
            overflow: "auto",
            maxHeight: 260,
          }}>
            {(() => {
              // Build display list: always include current model if set, then add other models
              const displayList: ModelEntry[] = [];
              const existingKeys = new Set<string>();

              // Add current model first if it exists
              if (model) {
                const currentModelEntry: ModelEntry = {
                  id: model.modelId,
                  name: modelNames?.[`${model.provider}:${model.modelId}`] ?? model.modelId,
                  provider: model.provider,
                };
                displayList.push(currentModelEntry);
                existingKeys.add(`${model.provider}:${model.modelId}`);
              }

              // Add other models from modelList
              if (modelList && modelList.length > 0) {
                for (const m of modelList) {
                  const key = `${m.provider}:${m.id}`;
                  if (!existingKeys.has(key)) {
                    displayList.push(m);
                    existingKeys.add(key);
                  }
                }
              }

              // Filter by search query
              const filteredList = modelSearchQuery.trim()
                ? displayList.filter((m) =>
                    m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
                    m.provider.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
                    m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
                  )
                : displayList;

              // If nothing to show
              if (filteredList.length === 0) {
                return (
                  <div style={{ padding: "16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
                    {modelSearchQuery
                      ? t("chat.no_models_found")
                      : (modelError ?? t("chat.no_models_available"))}
                  </div>
                );
              }

              return filteredList.map((m) => (
                <button
                  key={`${m.provider}:${m.id}`}
                  onClick={() => {
                    onModelChange(m.provider, m.id);
                    setShowModelMenu(false);
                    setModelSearchQuery("");
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    background: model?.provider === m.provider && model?.modelId === m.id ? "var(--bg-selected)" : "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    color: "var(--text)",
                    transition: "background 0.1s",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{m.provider}</span>
                  {model?.provider === m.provider && model?.modelId === m.id && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ));
            })()}
          </div>

          {/* Footer with count */}
          <div style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-muted)",
            textAlign: "center",
            background: "var(--bg-panel)",
            borderRadius: "0 0 10px 10px",
          }}>
            {(() => {
              const totalCount = (model ? 1 : 0) + (modelList?.length ?? 0);
              const query = modelSearchQuery.trim();
              if (query) {
                const filteredCount = (modelList ?? []).filter((m: ModelEntry) =>
                  m.name.toLowerCase().includes(query.toLowerCase()) ||
                  m.provider.toLowerCase().includes(query.toLowerCase()) ||
                  m.id.toLowerCase().includes(query.toLowerCase())
                ).length + (model && (
                  (modelNames?.[`${model.provider}:${model.modelId}`] ?? model.modelId).toLowerCase().includes(query.toLowerCase()) ||
                  model.provider.toLowerCase().includes(query.toLowerCase()) ||
                  model.modelId.toLowerCase().includes(query.toLowerCase())
                ) ? 1 : 0);
                return t("chat.models_filtered", String(filteredCount), String(totalCount));
              }
              return t("chat.models_count", String(totalCount));
            })()}
          </div>
        </div>
      )}

      {/* Attached images preview */}
      {attachedImages.length > 0 && (
        <div style={{
          display: "flex",
          gap: 6,
          marginBottom: 8,
          flexWrap: "wrap",
        }}>
          {attachedImages.map((img, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img
                src={img.previewUrl}
                alt="attachment"
                style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => removeImage(i)}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "var(--text)",
                  color: "var(--bg)",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--card-bg)",
        overflow: "hidden",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}>
        {/* Model selector button */}
        <button
          onClick={() => { setShowModelMenu(!showModelMenu); setShowSlashMenu(false); }}
          title={modelError ?? (modelList && modelList.length > 0 ? undefined : t("chat.no_models_available"))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minHeight: TEXTAREA_MIN_HEIGHT,
            height: "auto",
            padding: "0 10px",
            background: "none",
            border: "none",
            borderRight: "1px solid var(--border)",
            color: model ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            whiteSpace: "nowrap",
            flexShrink: 0,
            opacity: modelList && modelList.length === 0 && !model ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            <path d="M19 3v4" />
            <path d="M21 5h-4" />
          </svg>
          <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", fontWeight: model ? 500 : 400 }}>{modelLabel}</span>
          {(modelList && modelList.length > 0) && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: -2, opacity: 0.6 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>

        {/* Compact button */}
        {onCompact && (
          <button
            onClick={onCompact}
            disabled={isCompacting}
            title={t("chat.compact_context")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: TEXTAREA_MIN_HEIGHT,
              height: "auto",
              width: 36,
              background: "none",
              border: "none",
              borderRight: "1px solid var(--border)",
              color: isCompacting ? "var(--accent)" : "var(--text-dim)",
              cursor: isCompacting ? "wait" : "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isStreaming ? t("chat.type_to_steer") : t("chat.send_message")}
          rows={1}
          style={{
            flex: 1,
            minHeight: TEXTAREA_MIN_HEIGHT,
            maxHeight: TEXTAREA_MAX_HEIGHT,
            padding: "10px 12px",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text)",
            fontSize: 14,
            lineHeight: 1.5,
            resize: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />

        {/* Image attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title={t("chat.attach_image")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: TEXTAREA_MIN_HEIGHT,
            height: "auto",
            width: 36,
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        {/* Send/Abort button */}
        <button
          onClick={isStreaming ? onAbort : handleSend}
          disabled={!isStreaming && !text.trim() && !attachedImages.length}
          title={isStreaming ? t("chat.stop") : t("chat.send")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: TEXTAREA_MIN_HEIGHT,
            height: "auto",
            width: 44,
            background: isStreaming
              ? "color-mix(in srgb, var(--danger) 12%, transparent)"
              : (text.trim() || attachedImages.length) ? "var(--page-text)" : "transparent",
            border: "none",
            borderLeft: "1px solid var(--border)",
            color: isStreaming
              ? "var(--danger)"
              : (text.trim() || attachedImages.length) ? "var(--page-bg)" : "var(--text-dim)",
            cursor: isStreaming || (text.trim() || attachedImages.length) ? "pointer" : "default",
            flexShrink: 0,
            borderRadius: "0 11px 11px 0",
          }}
        >
          {isStreaming ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>

      {modelError && (
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--warn)" }}>{modelError}</div>
      )}
    </div>
  );
});

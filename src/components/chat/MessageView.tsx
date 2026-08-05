// MessageView — renders a single chat message (user, assistant, tool result, bash).
// Ported and simplified from pi-web's components/MessageView.tsx.

import { memo, useState, type ReactNode } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCallContent,
  TextContent,
  ThinkingContent,
  ImageContent,
  BashExecutionMessage,
  CustomMessage,
} from "@/types/chat";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  sessionId?: string;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function extractText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ─── Tool Call Block ─────────────────────────────────────

function ToolCallBlock({ block }: { block: ToolCallContent }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = JSON.stringify(block.input, null, 2);

  return (
    <div style={{
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: 8,
      background: "var(--bg-panel, #f9fafb)",
      overflow: "hidden",
      margin: "8px 0",
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-muted, #6b7280)",
          fontSize: 13,
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ fontWeight: 600, color: "var(--accent, #3f6fd8)" }}>{block.toolName}</span>
        <span className="label" style={{ fontSize: 10 }}>tool call</span>
      </button>
      {expanded && (
        <pre style={{
          margin: 0,
          padding: "8px 12px",
          borderTop: "1px solid var(--border, #e5e7eb)",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text-muted, #6b7280)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "auto",
          maxHeight: 300,
        }}>
          {inputStr}
        </pre>
      )}
    </div>
  );
}

// ─── Thinking Block ──────────────────────────────────────

function ThinkingBlock({ block }: { block: ThinkingContent }) {
  const [expanded, setExpanded] = useState(false);
  if (!block.thinking && block.deferred) {
    return (
      <div style={{ margin: "6px 0", fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>
        Thinking (collapsed)
      </div>
    );
  }

  return (
    <div style={{ margin: "8px 0" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--text-muted, #6b7280)",
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        Thinking
      </button>
      {expanded && (
        <div style={{
          marginTop: 6,
          padding: "8px 12px",
          borderLeft: "2px solid var(--border, #e5e7eb)",
          fontSize: 13,
          color: "var(--text-muted, #6b7280)",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono, monospace)",
          lineHeight: 1.6,
        }}>
          {block.thinking}
        </div>
      )}
    </div>
  );
}

// ─── Image Block ─────────────────────────────────────────

function ImageBlock({ block }: { block: ImageContent }) {
  const src = block.source.type === "url"
    ? block.source.url
    : `data:${block.source.media_type ?? "image/png"};base64,${block.source.data}`;
  return (
    <img
      src={src}
      alt="attachment"
      style={{
        maxWidth: "100%",
        maxHeight: 400,
        borderRadius: 8,
        margin: "8px 0",
      }}
    />
  );
}

// ─── Tool Result Block ───────────────────────────────────

function ToolResultView({ message }: { message: ToolResultMessage }) {
  const [expanded, setExpanded] = useState(false);
  const textContent = message.content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const truncated = textContent.length > 500;
  const displayText = expanded || !truncated ? textContent : textContent.slice(0, 500) + "...";

  return (
    <div style={{
      margin: "4px 0 8px 0",
      padding: "8px 12px",
      borderRadius: 8,
      background: message.isError ? "rgba(239,68,68,0.06)" : "var(--bg-panel, #f9fafb)",
      border: `1px solid ${message.isError ? "color-mix(in srgb, var(--danger) 30%, transparent)" : "var(--border, #e4e2db)"}`,
      fontSize: 13,
    }}>
      {message.toolName && (
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: message.isError ? "var(--danger)" : "var(--text-muted, #6f6d66)",
          marginBottom: 4,
        }}>
          {message.toolName} result {message.isError ? "(error)" : ""}
        </div>
      )}
      <pre style={{
        margin: 0,
        fontFamily: "var(--font-mono, monospace)",
        color: message.isError ? "#dc2626" : "var(--text-muted, #6b7280)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.5,
      }}>
        {displayText}
      </pre>
      {truncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 4,
            background: "none",
            border: "none",
            color: "var(--accent, #2563eb)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {expanded ? "Show less" : `Show ${textContent.length - 500} more characters`}
        </button>
      )}
    </div>
  );
}

// ─── Bash Execution View ─────────────────────────────────

function BashExecutionView({ message }: { message: BashExecutionMessage }) {
  return (
    <div style={{
      margin: "8px 0",
      borderRadius: 8,
      overflow: "hidden",
      border: "1px solid var(--border, #e5e7eb)",
    }}>
      <div style={{
        padding: "6px 12px",
        background: "var(--bg-panel, #f9fafb)",
        fontSize: 12,
        fontFamily: "var(--font-mono, monospace)",
        color: "var(--text-muted, #6b7280)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{ color: "var(--accent, #2563eb)" }}>$</span>
        <span>{message.command}</span>
        {message.exitCode !== undefined && (
          <span style={{ marginLeft: "auto", color: message.exitCode === 0 ? "var(--ok)" : "var(--danger)" }}>
            exit {message.exitCode}
          </span>
        )}
      </div>
      {message.output && (
        <pre style={{
          margin: 0,
          padding: "8px 12px",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text-muted, #6b7280)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 300,
          overflow: "auto",
        }}>
          {message.output}
        </pre>
      )}
    </div>
  );
}

// ─── Markdown Renderer (simplified) ──────────────────────

function renderMarkdown(text: string): ReactNode {
  // Simple markdown rendering: code blocks, inline code, bold, links, line breaks
  const parts: ReactNode[] = [];
  const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderInlineMarkdown(text.slice(lastIndex, match.index), `md-${key++}`));
    }
    const lang = match[1] || "text";
    const code = match[2];
    parts.push(
      <div key={`code-${key++}`} style={{
        margin: "8px 0",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border, #e5e7eb)",
      }}>
        <div style={{
          padding: "4px 12px",
          background: "var(--bg-panel, #f9fafb)",
          fontSize: 11,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono, monospace)",
          borderBottom: "1px solid var(--border, #e5e7eb)",
        }}>
          {lang}
        </div>
        <pre style={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 13,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text, #1f2937)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "auto",
          maxHeight: 500,
        }}>
          <code>{code}</code>
        </pre>
      </div>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(renderInlineMarkdown(text.slice(lastIndex), `md-${key++}`));
  }

  return <>{parts}</>;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode {
  // Split by lines for paragraph rendering
  const lines = text.split("\n");
  return (
    <div key={keyPrefix}>
      {lines.map((line, i) => (
        <div key={`${keyPrefix}-${i}`} style={{ minHeight: "1.5em" }}>
          {renderLine(line, `${keyPrefix}-${i}`)}
        </div>
      ))}
    </div>
  );
}

function renderLine(line: string, keyPrefix: string): ReactNode {
  // Handle inline code, bold, links
  const parts: ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-${key++}`} style={{
          padding: "1px 5px",
          borderRadius: 4,
          background: "var(--bg-panel, #f3f4f6)",
          fontSize: "0.9em",
          fontFamily: "var(--font-mono, monospace)",
        }}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a key={`${keyPrefix}-${key++}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent, #2563eb)", textDecoration: "underline" }}>
            {linkMatch[1]}
          </a>
        );
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : (line === "" ? "\u200B" : line);
}

// ─── Main MessageView ────────────────────────────────────

function MessageViewImpl({
  message,
  isStreaming,
  modelNames,
  cwd,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onEditContent,
  showTimestamp,
  sessionId,
}: Props) {
  if (message.role === "user") {
    const text = typeof message.content === "string"
      ? message.content
      : extractText(message.content);
    const images = Array.isArray(message.content)
      ? message.content.filter((b): b is ImageContent => b.type === "image")
      : [];

    return (
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 16,
      }}>
        <div style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: "16px 16px 4px 16px",
          background: "var(--page-text, #1a1a18)",
          color: "var(--page-bg, #f7f6f3)",
          fontSize: 14,
          lineHeight: 1.6,
          wordBreak: "break-word",
        }}>
          {text && <div>{renderMarkdown(text)}</div>}
          {images.map((img, i) => (
            <ImageBlock key={i} block={img} />
          ))}
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    const am = message as AssistantMessage;
    const blocks = am.content;
    const modelLabel = am.provider && am.model
      ? modelNames?.[`${am.provider}:${am.model}`] ?? am.model
      : am.model;

    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text, #1f2937)",
          }}>
            π {modelLabel && <span style={{ fontWeight: 400, color: "var(--text-muted, #6b7280)", fontSize: 12 }}>· {modelLabel}</span>}
          </span>
          {showTimestamp && message.timestamp && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {formatTimestamp(message.timestamp)}
            </span>
          )}
          {onFork && entryId && !isStreaming && (
            <button
              onClick={() => onFork(entryId)}
              disabled={forking}
              title="Fork from here"
              style={{
                background: "none",
                border: "none",
                cursor: forking ? "wait" : "pointer",
                color: "var(--text-dim)",
                padding: 0,
                fontSize: 11,
              }}
            >
              {forking ? "⏳" : "⎇"}
            </button>
          )}
        </div>
        <div style={{
          padding: "0 2px",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text, #1f2937)",
        }}>
          {blocks.map((block, i) => {
            switch (block.type) {
              case "text":
                return <div key={i}>{renderMarkdown(block.text)}</div>;
              case "thinking":
                return <ThinkingBlock key={i} block={block} />;
              case "toolCall":
                return <ToolCallBlock key={i} block={block} />;
              case "image":
                return <ImageBlock key={i} block={block} />;
              default:
                return null;
            }
          })}
          {am.errorMessage && (
            <div style={{
              marginTop: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.06)",
              color: "#dc2626",
              fontSize: 13,
            }}>
              {am.errorMessage}
            </div>
          )}
          {am.usage && (
            <div className="num" style={{
              marginTop: 6,
              fontSize: 11,
              color: "var(--text-dim)",
              display: "flex",
              gap: 12,
            }}>
              <span>in: {am.usage.input.toLocaleString()}</span>
              <span>out: {am.usage.output.toLocaleString()}</span>
              {am.usage.cacheRead > 0 && <span>cache: {am.usage.cacheRead.toLocaleString()}</span>}
              {am.usage.cost?.total ? <span>${am.usage.cost.total.toFixed(4)}</span> : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.role === "toolResult") {
    return <ToolResultView message={message as ToolResultMessage} />;
  }

  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} />;
  }

  if (message.role === "custom") {
    const cm = message as CustomMessage;
    if (!cm.display) return null;
    const text = typeof cm.content === "string" ? cm.content : extractText(cm.content);
    if (cm.customType === "compaction") {
      return (
        <div style={{
          margin: "12px 0",
          padding: "8px 14px",
          borderRadius: 8,
          background: "var(--bg-panel, #f9fafb)",
          border: "1px solid var(--border, #e5e7eb)",
          fontSize: 13,
          color: "var(--text-muted, #6b7280)",
          fontStyle: "italic",
        }}>
          {text}
        </div>
      );
    }
    return (
      <div style={{
        margin: "8px 0",
        padding: "8px 14px",
        borderRadius: 8,
        background: "var(--bg-panel, #f9fafb)",
        fontSize: 13,
        color: "var(--text-muted, #6b7280)",
      }}>
        {text}
      </div>
    );
  }

  return null;
}

export const MessageView = memo(MessageViewImpl);

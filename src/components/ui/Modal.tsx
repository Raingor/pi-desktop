import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClasses = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  // Render into document.body via a portal. The app shell uses
  // `transform: scale(--ui-zoom)`, which turns it into the containing block
  // for position:fixed descendants — so a modal rendered inside it would be
  // positioned relative to the (tall, scrollable) shell instead of the
  // viewport, pushing the dialog off-screen while only the backdrop shows.
  return createPortal(
    <div className="modal-shell">
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`tech-modal ${sizeClasses[size]}`}>
        <div className="modal-header">
          <div>
            <span className="modal-kicker">COMMAND DIALOG</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>,
    document.body
  );
}

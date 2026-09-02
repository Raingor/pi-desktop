import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("empty-signal", className)}>
      <div className="empty-signal-radar"><span>{icon}</span></div>
      <p className="empty-signal-code">NO SIGNAL // STANDBY</p>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

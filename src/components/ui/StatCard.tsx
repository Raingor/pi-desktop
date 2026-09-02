import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ title, value, subtitle, icon, trend, className }: StatCardProps) {
  return (
    <div className={cn("tech-panel stat-instrument", className)}>
      <span className="panel-corner panel-corner-tl" />
      <span className="panel-corner panel-corner-br" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="instrument-label">{title}</p>
          <p className="instrument-value">{value}</p>
          {subtitle && <p className="instrument-meta">{subtitle}</p>}
          {trend && (
            <span className={cn("instrument-trend", trend.positive ? "is-positive" : "is-negative")}>
              <span>{trend.positive ? "↑" : "↓"}</span>
              {trend.value}
            </span>
          )}
        </div>
        <div className="instrument-icon">{icon}</div>
      </div>
    </div>
  );
}

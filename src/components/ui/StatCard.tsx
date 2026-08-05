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
    <div className={cn("theme-card rise p-5", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="label">{title}</p>
          <p className="num text-[26px] font-semibold leading-none tracking-tight" style={{ color: "var(--page-text)" }}>
            {value}
          </p>
          {subtitle && <p className="text-xs" style={{ color: "var(--subtle-text)" }}>{subtitle}</p>}
          {trend && (
            <span
              className="num inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: trend.positive ? "var(--ok)" : "var(--danger)" }}
            >
              <span>{trend.positive ? "↑" : "↓"}</span>
              {trend.value}
            </span>
          )}
        </div>
        <div
          className="rounded-[10px] p-2.5"
          style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

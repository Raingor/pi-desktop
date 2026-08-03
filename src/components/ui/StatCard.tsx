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
    <div className={cn("rounded-xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur-sm", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-400">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                trend.positive ? "text-emerald-400" : "text-red-400"
              )}
            >
              <span>{trend.positive ? "↑" : "↓"}</span>
              {trend.value}
            </span>
          )}
        </div>
        <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-400">{icon}</div>
      </div>
    </div>
  );
}
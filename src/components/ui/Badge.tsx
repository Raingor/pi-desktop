import { cn } from "@/lib/utils";

interface BadgeProps {
  children: string;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}

const variants = {
  default: "bg-gray-800 text-gray-300",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
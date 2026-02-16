"use client";

import { cn } from "@/lib/utils";

const statusConfig = {
  connected: { color: "bg-discord-green", label: "Connected" },
  connecting: { color: "bg-discord-yellow", label: "Connecting" },
  error: { color: "bg-discord-red", label: "Error" },
  stopped: { color: "bg-discord-text-muted", label: "Stopped" },
} as const;

interface StatusBadgeProps {
  status: keyof typeof statusConfig;
  showLabel?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  showLabel = true,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.stopped;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-2 w-2 rounded-full", config.color)} />
      {showLabel && (
        <span className="text-xs text-discord-text-secondary">
          {config.label}
        </span>
      )}
    </span>
  );
}

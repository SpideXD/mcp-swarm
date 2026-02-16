"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";

const typeColors: Record<string, string> = {
  "server:status": "bg-discord-blurple/20 text-discord-blurple",
  "server:added": "bg-discord-green/20 text-discord-green",
  "server:removed": "bg-discord-red/20 text-discord-red",
  "tool:call": "bg-discord-yellow/20 text-discord-yellow",
  "tool:result": "bg-discord-bg-elevated text-discord-text-secondary",
  "session:created": "bg-discord-green/20 text-discord-green",
  "session:closed": "bg-discord-bg-elevated text-discord-text-muted",
  "pool:scaled": "bg-discord-blurple/20 text-discord-blurple",
};

interface EventCardProps {
  event: ActivityEvent;
}

export function EventCard({ event }: EventCardProps) {
  const colorClass = typeColors[event.type] ?? "bg-discord-bg-elevated text-discord-text-muted";

  return (
    <div className="flex items-start gap-3 rounded px-3 py-2 hover:bg-discord-bg-elevated">
      <span className="mt-0.5 shrink-0 text-xs text-discord-text-muted">
        {new Date(event.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
      <Badge className={cn("shrink-0 text-xs", colorClass)}>
        {event.type}
      </Badge>
      <pre className="flex-1 overflow-hidden text-ellipsis whitespace-pre-wrap text-xs text-discord-text-secondary">
        {JSON.stringify(event.data, null, 2)}
      </pre>
    </div>
  );
}

"use client";

import { useActivityStore } from "@/lib/stores/activity";
import { cn } from "@/lib/utils";

const eventTypeColors: Record<string, string> = {
  "server:status": "text-discord-blurple",
  "server:added": "text-discord-green",
  "server:removed": "text-discord-red",
  "tool:call": "text-discord-yellow",
  "tool:result": "text-discord-text-secondary",
  "session:created": "text-discord-green",
  "session:closed": "text-discord-text-muted",
  "pool:scaled": "text-discord-blurple",
};

export function RecentActivity() {
  const events = useActivityStore((s) => s.events);
  const recent = events.slice(0, 10);

  if (recent.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-xs text-discord-text-muted">
          No recent activity. Events will appear here in real-time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {recent.map((event) => (
        <div
          key={event.id}
          className="flex items-center gap-3 rounded px-3 py-1.5 text-xs hover:bg-discord-bg-elevated"
        >
          <span
            className={cn(
              "w-28 shrink-0 font-mono",
              eventTypeColors[event.type] ?? "text-discord-text-muted"
            )}
          >
            {event.type}
          </span>
          <span className="flex-1 truncate text-discord-text-secondary">
            {formatEventData(event.data)}
          </span>
          <span className="shrink-0 text-discord-text-muted">
            {formatTime(event.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatEventData(data: Record<string, unknown>): string {
  if (data.serverName) return String(data.serverName);
  if (data.sessionId) return `session: ${String(data.sessionId).slice(0, 8)}...`;
  if (data.name) return String(data.name);
  return JSON.stringify(data).slice(0, 80);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

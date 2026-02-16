"use client";

import { cn } from "@/lib/utils";

const eventCategories = [
  { label: "Server", types: ["server:status", "server:added", "server:removed"] },
  { label: "Tool", types: ["tool:call", "tool:result"] },
  { label: "Session", types: ["session:created", "session:closed"] },
  { label: "Pool", types: ["pool:scaled"] },
];

interface ActivityFiltersProps {
  enabled: Set<string>;
  onToggle: (types: string[]) => void;
}

export function ActivityFilters({ enabled, onToggle }: ActivityFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {eventCategories.map((cat) => {
        const active = cat.types.some((t) => enabled.has(t));
        return (
          <button
            key={cat.label}
            onClick={() => onToggle(cat.types)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-discord-blurple text-white"
                : "bg-discord-bg-elevated text-discord-text-muted hover:text-discord-text-secondary"
            )}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}

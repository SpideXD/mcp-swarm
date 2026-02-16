"use client";

import { useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { useActivityStore } from "@/lib/stores/activity";
import { useConnectionStore } from "@/lib/stores/connection";

export default function ActivityPage() {
  const connected = useConnectionStore((s) => s.connected);
  const clearEvents = useActivityStore((s) => s.clearEvents);
  const eventCount = useActivityStore((s) => s.events.length);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((types: string[]) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      const allActive = types.every((t) => next.has(t));
      if (allActive) {
        types.forEach((t) => next.delete(t));
      } else {
        types.forEach((t) => next.add(t));
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-discord-text-primary">
            Activity
          </h2>
          <p className="text-sm text-discord-text-muted">
            Real-time event feed ({eventCount} events)
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearEvents}
          className="text-discord-text-muted hover:text-discord-red"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>

      {!connected ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to see real-time
            activity.
          </p>
        </div>
      ) : (
        <>
          <ActivityFilters enabled={typeFilter} onToggle={handleToggle} />
          <ActivityFeed typeFilter={typeFilter} />
        </>
      )}
    </div>
  );
}

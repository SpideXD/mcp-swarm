"use client";

import { useActivityStore } from "@/lib/stores/activity";
import { EventCard } from "./event-card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActivityFeedProps {
  typeFilter: Set<string>;
}

export function ActivityFeed({ typeFilter }: ActivityFeedProps) {
  const events = useActivityStore((s) => s.events);

  const filtered =
    typeFilter.size === 0
      ? events
      : events.filter((e) => typeFilter.has(e.type));

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-xs text-discord-text-muted">
          No events yet. Activity will appear here in real-time via SSE.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-14rem)]">
      <div className="space-y-0.5">
        {filtered.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </ScrollArea>
  );
}

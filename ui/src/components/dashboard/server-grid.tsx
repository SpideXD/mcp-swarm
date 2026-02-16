"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/servers/status-badge";
import { useServersStore } from "@/lib/stores/servers";

export function ServerGrid() {
  const servers = useServersStore((s) => s.servers);

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-discord-text-muted">
          No servers configured. Add a server or activate a profile to get
          started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {servers.map((server) => (
        <Card
          key={server.name}
          className="border-0 bg-discord-bg-sidebar transition-colors hover:bg-discord-bg-elevated"
        >
          <CardContent className="p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-discord-text-primary">
                {server.name}
              </h3>
              <StatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-discord-text-muted">
              <Badge
                variant="secondary"
                className="bg-discord-bg-elevated px-1.5 py-0 text-[10px] text-discord-text-secondary"
              >
                {server.type}
              </Badge>
              {server.tools > 0 && <span>{server.tools} tools</span>}
              {server.pid && <span>PID: {server.pid}</span>}
            </div>
            {server.error && (
              <p className="mt-1 truncate text-xs text-discord-red">
                {server.error}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

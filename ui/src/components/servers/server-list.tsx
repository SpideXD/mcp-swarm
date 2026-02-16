"use client";

import { useServersStore } from "@/lib/stores/servers";
import { ServerCard } from "./server-card";

export function ServerList() {
  const servers = useServersStore((s) => s.servers);
  const loading = useServersStore((s) => s.loading);

  if (loading && servers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-discord-text-muted">
        Loading servers...
      </p>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="mb-2 text-sm text-discord-text-secondary">
          No servers configured yet
        </p>
        <p className="text-xs text-discord-text-muted">
          Click "Add Server" to add an MCP server, or go to Profiles to activate
          a preset configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {servers.map((server) => (
        <ServerCard key={server.name} server={server} />
      ))}
    </div>
  );
}

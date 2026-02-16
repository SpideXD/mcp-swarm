"use client";

import { useEffect } from "react";
import { ServerList } from "@/components/servers/server-list";
import { AddServerDialog } from "@/components/servers/add-server-dialog";
import { useConnectionStore } from "@/lib/stores/connection";
import { useServersStore } from "@/lib/stores/servers";

export default function ServersPage() {
  const connected = useConnectionStore((s) => s.connected);
  const fetchServers = useServersStore((s) => s.fetchServers);

  useEffect(() => {
    if (connected) fetchServers();
  }, [connected, fetchServers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-discord-text-primary">
            Servers
          </h2>
          <p className="text-sm text-discord-text-muted">
            Manage your MCP servers
          </p>
        </div>
        {connected && <AddServerDialog />}
      </div>

      {!connected ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to manage servers.
          </p>
        </div>
      ) : (
        <ServerList />
      )}
    </div>
  );
}

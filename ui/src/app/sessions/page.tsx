"use client";

import { useEffect } from "react";
import { SessionList } from "@/components/sessions/session-list";
import { useConnectionStore } from "@/lib/stores/connection";
import { useSessionsStore } from "@/lib/stores/sessions";

export default function SessionsPage() {
  const connected = useConnectionStore((s) => s.connected);
  const fetchSessions = useSessionsStore((s) => s.fetchSessions);

  useEffect(() => {
    if (!connected) return;
    fetchSessions();
    const interval = setInterval(fetchSessions, 10_000);
    return () => clearInterval(interval);
  }, [connected, fetchSessions]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-discord-text-primary">
          Sessions
        </h2>
        <p className="text-sm text-discord-text-muted">
          Active MCP sessions on the swarm server
        </p>
      </div>

      {!connected ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to view sessions.
          </p>
        </div>
      ) : (
        <SessionList />
      )}
    </div>
  );
}

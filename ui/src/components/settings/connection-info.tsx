"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useConnectionStore } from "@/lib/stores/connection";

export function ConnectionInfo() {
  const { url, sessionId, connected } = useConnectionStore();

  return (
    <Card className="border-0 bg-discord-bg-sidebar">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
          Connection
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-discord-text-muted">Status</span>
            <span
              className={
                connected ? "text-discord-green" : "text-discord-red"
              }
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-discord-text-muted">URL</span>
            <span className="font-mono text-xs text-discord-text-secondary">
              {url}
            </span>
          </div>
          {sessionId && (
            <div className="flex justify-between">
              <span className="text-discord-text-muted">Session ID</span>
              <span className="font-mono text-xs text-discord-text-secondary">
                {sessionId}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

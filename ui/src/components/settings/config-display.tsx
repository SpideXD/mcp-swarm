"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { SwarmConfig } from "@/lib/types";

interface ConfigDisplayProps {
  config: SwarmConfig | null;
  loading: boolean;
}

const configLabels: Record<string, string> = {
  port: "HTTP Port",
  host: "Bind Host",
  socket: "Unix Socket",
  mode: "Bridge Mode",
  sessionIdleTimeoutMs: "Session Idle Timeout",
  sessionCleanupIntervalMs: "Cleanup Interval",
  maxSessions: "Max Sessions",
  toolCallTimeoutMs: "Tool Call Timeout",
  maxServerInstances: "Max Server Instances",
  cors: "CORS Enabled",
};

export function ConfigDisplay({ config, loading }: ConfigDisplayProps) {
  if (loading) {
    return (
      <Card className="border-0 bg-discord-bg-sidebar">
        <CardContent className="p-4">
          <p className="text-sm text-discord-text-muted">Loading config...</p>
        </CardContent>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card className="border-0 bg-discord-bg-sidebar">
        <CardContent className="p-4">
          <p className="text-sm text-discord-text-muted">
            Connect to view server configuration.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 bg-discord-bg-sidebar">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
          Server Configuration
        </h3>
        <div className="overflow-hidden rounded border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-discord-bg-darkest text-xs uppercase text-discord-text-muted">
                <th className="px-4 py-2 text-left">Setting</th>
                <th className="px-4 py-2 text-left">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config).map(([key, value]) => (
                <tr
                  key={key}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2 text-discord-text-secondary">
                    {configLabels[key] ?? key}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-discord-text-primary">
                    {formatValue(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // Format millisecond values as human-readable
    if (value > 10000) return `${(value / 1000).toFixed(0)}s (${value}ms)`;
    return String(value);
  }
  return String(value);
}

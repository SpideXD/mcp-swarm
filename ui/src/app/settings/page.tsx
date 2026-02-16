"use client";

import { useEffect, useState } from "react";
import { ConnectionInfo } from "@/components/settings/connection-info";
import { ConfigDisplay } from "@/components/settings/config-display";
import { useConnectionStore } from "@/lib/stores/connection";
import type { SwarmConfig } from "@/lib/types";

export default function SettingsPage() {
  const connected = useConnectionStore((s) => s.connected);
  const apiClient = useConnectionStore((s) => s.apiClient);
  const [config, setConfig] = useState<SwarmConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !apiClient) return;
    setLoading(true);
    apiClient
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [connected, apiClient]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-discord-text-primary">
          Settings
        </h2>
        <p className="text-sm text-discord-text-muted">
          Connection and server configuration
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ConnectionInfo />
        <ConfigDisplay config={config} loading={loading} />
      </div>

      {/* Environment variables reference */}
      <div className="rounded-lg bg-discord-bg-sidebar p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
          Environment Variables
        </h3>
        <div className="overflow-hidden rounded border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-discord-bg-darkest text-xs uppercase text-discord-text-muted">
                <th className="px-4 py-2 text-left">Variable</th>
                <th className="px-4 py-2 text-left">Default</th>
                <th className="px-4 py-2 text-left">Description</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {envVarDocs.map((v) => (
                <tr key={v.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-discord-text-primary">
                    {v.name}
                  </td>
                  <td className="px-4 py-2 text-discord-text-secondary">
                    {v.default}
                  </td>
                  <td className="px-4 py-2 text-discord-text-muted">
                    {v.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const envVarDocs = [
  { name: "SWARM_PORT", default: "3100", description: "HTTP server port" },
  { name: "SWARM_HOST", default: "127.0.0.1", description: "HTTP server bind address" },
  { name: "SWARM_SOCKET", default: "(none)", description: "Unix socket path (overrides port/host)" },
  { name: "SWARM_MODE", default: "http", description: "Bridge mode (http or stdio)" },
  { name: "SWARM_CORS", default: "true", description: "Enable CORS headers" },
  { name: "SWARM_MAX_SESSIONS", default: "10", description: "Maximum concurrent sessions" },
  { name: "SWARM_SESSION_IDLE_TIMEOUT_MS", default: "1800000", description: "Session idle timeout (30min)" },
  { name: "SWARM_TOOL_CALL_TIMEOUT_MS", default: "120000", description: "Tool call timeout (2min)" },
  { name: "SWARM_MAX_INSTANCES", default: "5", description: "Max server instances for pool scaling" },
];

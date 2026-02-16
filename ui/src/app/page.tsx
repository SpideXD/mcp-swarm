"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ServerGrid } from "@/components/dashboard/server-grid";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { useConnectionStore } from "@/lib/stores/connection";
import { useServersStore } from "@/lib/stores/servers";
import type { HealthInfo } from "@/lib/types";

export default function DashboardPage() {
  const {
    connected,
    connecting,
    error,
    url,
    sessionId,
    connect,
    disconnect,
    mcpClient,
  } = useConnectionStore();
  const fetchServers = useServersStore((s) => s.fetchServers);
  const [connectUrl, setConnectUrl] = useState(url);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  // Fetch data on connect + periodic refresh
  useEffect(() => {
    if (!connected || !mcpClient) return;
    fetchServers();
    mcpClient.getHealth().then(setHealth).catch(() => {});
    const interval = setInterval(() => {
      mcpClient.getHealth().then(setHealth).catch(() => {});
      fetchServers();
    }, 15_000);
    return () => clearInterval(interval);
  }, [connected, mcpClient, fetchServers]);

  const handleConnect = async () => {
    try {
      await connect(connectUrl);
      toast.success("Connected to swarm");
    } catch {
      // Error is already in store, toast not needed
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setHealth(null);
    toast.info("Disconnected from swarm");
  };

  return (
    <div className="space-y-6">
      {/* Connection Banner */}
      <div className="flex items-center gap-3 rounded-lg bg-discord-bg-sidebar p-4">
        {connected ? (
          <>
            <Wifi className="h-5 w-5 shrink-0 text-discord-green" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-discord-text-primary">
                Connected to {url}
              </p>
              {sessionId && (
                <p className="text-xs text-discord-text-muted">
                  Session: {sessionId.slice(0, 8)}...
                </p>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 bg-discord-bg-elevated"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <WifiOff className="h-5 w-5 shrink-0 text-discord-red" />
            <Input
              value={connectUrl}
              onChange={(e) => setConnectUrl(e.target.value)}
              placeholder="http://localhost:3100"
              className="max-w-xs bg-discord-bg-darkest"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !connecting) handleConnect();
              }}
            />
            <Button
              size="sm"
              className="shrink-0 bg-discord-blurple hover:bg-discord-blurple/80"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-discord-red/10 p-3 text-sm text-discord-red">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => useConnectionStore.setState({ error: null })}
            className="shrink-0 text-discord-red/60 hover:text-discord-red"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {connected && (
        <>
          <StatsCards health={health} />

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
              Servers
            </h3>
            <ServerGrid />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
              Quick Actions
            </h3>
            <QuickActions />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase text-discord-text-muted">
              Recent Activity
            </h3>
            <RecentActivity />
          </div>
        </>
      )}
    </div>
  );
}

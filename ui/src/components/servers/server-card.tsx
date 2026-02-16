"use client";

import { useState } from "react";
import {
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Wrench,
  Loader2,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { ServerLogs } from "./server-logs";
import { EditServerDialog } from "./edit-server-dialog";
import { useServersStore } from "@/lib/stores/servers";
import type { ServerInfo } from "@/lib/types";

interface ServerCardProps {
  server: ServerInfo;
}

export function ServerCard({ server }: ServerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [starting, setStarting] = useState(false);
  const restartServer = useServersStore((s) => s.restartServer);
  const removeServer = useServersStore((s) => s.removeServer);
  const stopServer = useServersStore((s) => s.stopServer);
  const startServer = useServersStore((s) => s.startServer);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartServer(server.name);
      toast.success(`Server "${server.name}" restarted`);
    } catch (err) {
      toast.error(`Failed to restart "${server.name}"`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestarting(false);
    }
  };

  const handleRemove = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setRemoving(true);
    try {
      await removeServer(server.name);
      toast.success(`Server "${server.name}" removed`);
    } catch (err) {
      toast.error(`Failed to remove "${server.name}"`, {
        description: err instanceof Error ? err.message : String(err),
      });
      setRemoving(false);
      setConfirming(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopServer(server.name);
      toast.success(`Server "${server.name}" stopped`);
    } catch (err) {
      toast.error(`Failed to stop "${server.name}"`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setStopping(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await startServer(server.name);
      toast.success(`Server "${server.name}" started`);
    } catch (err) {
      toast.error(`Failed to start "${server.name}"`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setStarting(false);
    }
  };

  const isRunning = server.status === "connected";
  const isError = server.status === "error";
  const isStopped = server.status === "stopped";

  return (
    <Card className="border-0 bg-discord-bg-sidebar">
      <CardContent className="p-0">
        {/* Main row */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-discord-text-muted hover:text-discord-text-primary"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {/* Server info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-discord-text-primary">
                {server.name}
              </h3>
              <StatusBadge status={server.status} />
              {server.stateful && (
                <Badge
                  variant="outline"
                  className="border-discord-blurple/30 text-[10px] text-discord-blurple"
                >
                  stateful
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-discord-text-muted">
              <Badge
                variant="secondary"
                className="bg-discord-bg-elevated px-1.5 py-0 text-[10px] text-discord-text-secondary"
              >
                {server.type}
              </Badge>
              {server.tools > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Wrench className="h-3 w-3" />
                  {server.tools} tools
                </span>
              )}
              {server.pid && (
                <span className="inline-flex items-center gap-1">
                  <Terminal className="h-3 w-3" />
                  PID: {server.pid}
                </span>
              )}
            </div>
            {server.error && (
              <p className="mt-1 truncate text-xs text-discord-red">
                {server.error}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1">
            {/* Edit button */}
            <EditServerDialog server={server} />

            {/* Stop button — shown when running or connecting */}
            {!isStopped && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-discord-text-muted hover:text-discord-text-primary"
                onClick={handleStop}
                disabled={stopping}
                title="Stop server (keep config)"
              >
                {stopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PowerOff className="h-3.5 w-3.5" />
                )}
                Stop
              </Button>
            )}

            {/* Start button — shown when stopped */}
            {isStopped && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-discord-green hover:text-discord-green/80"
                onClick={handleStart}
                disabled={starting}
                title="Start server"
              >
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                Start
              </Button>
            )}

            {/* Restart / Reset button — hidden when stopped */}
            {!isStopped && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-discord-text-muted hover:text-discord-text-primary"
                onClick={handleRestart}
                disabled={restarting}
                title={isError ? "Reset error & retry" : "Restart server"}
              >
                {restarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {isError ? "Reset" : "Restart"}
              </Button>
            )}

            {/* Remove button with confirmation */}
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 gap-1.5 px-2 text-xs ${
                confirming
                  ? "bg-discord-red/10 text-discord-red hover:bg-discord-red/20 hover:text-discord-red"
                  : "text-discord-text-muted hover:text-discord-red"
              }`}
              onClick={handleRemove}
              disabled={removing}
              title={confirming ? "Click again to confirm removal" : "Remove server"}
            >
              {removing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {confirming ? "Confirm?" : "Remove"}
            </Button>
          </div>
        </div>

        {/* Expanded: logs */}
        {expanded && (
          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase text-discord-text-muted">
              Stderr Logs
            </p>
            <ServerLogs serverName={server.name} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

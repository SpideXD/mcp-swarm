"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConnectionStore } from "@/lib/stores/connection";

const REFRESH_INTERVAL_MS = 5000;

interface ServerLogsProps {
  serverName: string;
}

export function ServerLogs({ serverName }: ServerLogsProps) {
  const apiClient = useConnectionStore((s) => s.apiClient);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(() => {
    if (!apiClient) return;
    apiClient
      .getLogs(serverName)
      .then((newLogs) => {
        setLogs(newLogs);
        setLoading(false);
      })
      .catch(() => {
        setLogs(["Failed to fetch logs"]);
        setLoading(false);
      });
  }, [apiClient, serverName]);

  // Initial fetch + auto-refresh every 5s
  useEffect(() => {
    setLoading(true);
    fetchLogs();
    const timer = setInterval(fetchLogs, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <ScrollArea ref={scrollRef} className="h-48 rounded bg-discord-bg-darkest p-3 font-mono text-xs">
      {loading ? (
        <p className="text-discord-text-muted">Loading logs...</p>
      ) : logs.length === 0 ? (
        <p className="text-discord-text-muted">No logs available</p>
      ) : (
        logs.map((line, i) => (
          <div key={i} className="text-discord-text-secondary">
            {line}
          </div>
        ))
      )}
    </ScrollArea>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ToolBrowser } from "@/components/tools/tool-browser";
import { ToolExecutor } from "@/components/tools/tool-executor";
import { useConnectionStore } from "@/lib/stores/connection";
import { useToolsStore } from "@/lib/stores/tools";
import type { ToolInfo } from "@/lib/types";

export default function ToolsPage() {
  const connected = useConnectionStore((s) => s.connected);
  const tools = useToolsStore((s) => s.tools);
  const fetchTools = useToolsStore((s) => s.fetchTools);
  const [selected, setSelected] = useState<ToolInfo | null>(null);

  useEffect(() => {
    if (connected) fetchTools();
  }, [connected, fetchTools]);

  if (!connected) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-discord-text-primary">
            Tools
          </h2>
          <p className="text-sm text-discord-text-muted">
            Browse and test tools across all connected servers
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to browse tools.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-0 overflow-hidden rounded-lg border border-border">
      {/* Left panel: browser */}
      <div className="w-72 shrink-0 border-r border-border bg-discord-bg-sidebar">
        <ToolBrowser tools={tools} selected={selected} onSelect={setSelected} />
      </div>

      {/* Right panel: detail + executor */}
      <div className="flex-1 overflow-auto bg-discord-bg-main">
        {selected ? (
          <ToolExecutor tool={selected} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-discord-text-muted">
              Select a tool from the browser to view details and execute
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

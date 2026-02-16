"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Search, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ToolInfo } from "@/lib/types";

interface ToolBrowserProps {
  tools: ToolInfo[];
  selected: ToolInfo | null;
  onSelect: (tool: ToolInfo) => void;
}

export function ToolBrowser({ tools, selected, onSelect }: ToolBrowserProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string> | "all">("all");

  const filtered = useMemo(() => {
    if (!filter) return tools;
    const lower = filter.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.server.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower)
    );
  }, [tools, filter]);

  // Group by server
  const grouped = useMemo(() => {
    const map = new Map<string, ToolInfo[]>();
    for (const tool of filtered) {
      const server = tool.server || "Unknown";
      if (!map.has(server)) map.set(server, []);
      map.get(server)!.push(tool);
    }
    return map;
  }, [filtered]);

  const isExpanded = (server: string) =>
    expanded === "all" || expanded.has(server);

  const toggleServer = (server: string) => {
    setExpanded((prev) => {
      if (prev === "all") {
        // Collapsing one: expand all except this one
        const next = new Set(Array.from(grouped.keys()));
        next.delete(server);
        return next;
      }
      const next = new Set(prev);
      if (next.has(server)) next.delete(server);
      else next.add(server);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative p-2">
        <Search className="absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-discord-text-muted" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools..."
          className="h-8 bg-discord-bg-darkest pl-7 text-xs"
        />
      </div>
      <ScrollArea className="flex-1">
        {grouped.size === 0 ? (
          <p className="px-4 py-4 text-xs text-discord-text-muted">
            No tools found
          </p>
        ) : (
          Array.from(grouped.entries()).map(([server, serverTools]) => (
            <div key={server}>
              <button
                onClick={() => toggleServer(server)}
                className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase text-discord-text-muted hover:text-discord-text-secondary"
              >
                {isExpanded(server) ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {server} ({serverTools.length})
              </button>
              {isExpanded(server) &&
                serverTools.map((tool) => (
                  <button
                    key={`${tool.server}-${tool.name}`}
                    onClick={() => onSelect(tool)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-4 py-1 text-xs transition-colors hover:bg-discord-bg-elevated",
                      selected?.name === tool.name &&
                        selected?.server === tool.server &&
                        "bg-discord-bg-elevated text-discord-text-primary"
                    )}
                  >
                    <Wrench className="h-3 w-3 shrink-0 text-discord-text-muted" />
                    <span className="truncate text-discord-text-secondary">
                      {tool.name}
                    </span>
                  </button>
                ))}
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}

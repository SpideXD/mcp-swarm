"use client";

import { Loader2 } from "lucide-react";
import { RegistryCard } from "./registry-card";
import type { RegistryResult } from "@/lib/types";

interface RegistryResultsProps {
  results: RegistryResult[];
  loading: boolean;
  searched: boolean;
  onAdd: (result: RegistryResult) => void;
  adding?: string | null;
}

export function RegistryResults({
  results,
  loading,
  searched,
  onAdd,
  adding,
}: RegistryResultsProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-discord-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Searching registry...
      </div>
    );
  }

  if (!searched) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-discord-text-secondary">
          Search the MCP registry to discover servers
        </p>
        <p className="mt-1 text-xs text-discord-text-muted">
          2290+ servers available for weather, databases, APIs, and more
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-discord-text-muted">
          No results found. Try a different search query.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((result) => (
        <RegistryCard
          key={result.name}
          result={result}
          onAdd={onAdd}
          isAdding={adding === result.name}
        />
      ))}
    </div>
  );
}

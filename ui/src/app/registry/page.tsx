"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { SearchBar } from "@/components/registry/search-bar";
import { RegistryResults } from "@/components/registry/registry-results";
import { useConnectionStore } from "@/lib/stores/connection";
import { useServersStore } from "@/lib/stores/servers";
import type { RegistryResult } from "@/lib/types";

export default function RegistryPage() {
  const connected = useConnectionStore((s) => s.connected);
  const mcpClient = useConnectionStore((s) => s.mcpClient);
  const addServer = useServersStore((s) => s.addServer);
  const [results, setResults] = useState<RegistryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const handleSearch = useCallback(
    async (query: string) => {
      if (!mcpClient) return;
      setLoading(true);
      setSearched(true);
      try {
        const res = await mcpClient.searchRegistry(query);
        setResults(res);
      } catch (err) {
        setResults([]);
        toast.error("Search failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoading(false);
      }
    },
    [mcpClient]
  );

  const handleAdd = async (result: RegistryResult) => {
    setAdding(result.name);

    try {
      const installCmd = result.installCommand;
      if (!installCmd) {
        throw new Error("No install command available for this server");
      }

      const parts = installCmd.split(/\s+/).filter(Boolean);
      const command = parts[0];
      const args = parts.slice(1);

      const serverName = result.name
        .replace(/^@[^/]+\//, "")
        .replace(/^mcp-server-/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "-");

      await addServer({
        name: serverName,
        type: "STDIO",
        command,
        args,
        description: result.description,
      });

      toast.success(`Server "${serverName}" added to swarm`);
    } catch (err) {
      toast.error("Failed to add server", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-discord-text-primary">
          Registry
        </h2>
        <p className="text-sm text-discord-text-muted">
          Search and discover MCP servers from the official registry
        </p>
      </div>

      {!connected ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to search the registry.
          </p>
        </div>
      ) : (
        <>
          <SearchBar onSearch={handleSearch} />
          <RegistryResults
            results={results}
            loading={loading}
            searched={searched}
            onAdd={handleAdd}
            adding={adding}
          />
          {searched && !loading && results.length > 0 && (
            <p className="text-xs text-discord-text-muted text-center pt-2">
              Searching MCP Registry, npm, and Smithery. Servers without an
              install command can be added manually via the Servers page.
            </p>
          )}
        </>
      )}
    </div>
  );
}

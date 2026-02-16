"use client";

import { useState } from "react";
import { Plus, X, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useProfilesStore } from "@/lib/stores/profiles";
import { useServersStore } from "@/lib/stores/servers";
import type { ServerInfo } from "@/lib/types";

interface CustomServerRow {
  name: string;
  command: string;
  args: string;
  description: string;
}

const emptyServer: CustomServerRow = {
  name: "",
  command: "",
  args: "",
  description: "",
};

/** Parse "command: npx -y @playwright/mcp" into { command, args } */
function parseConnection(server: ServerInfo): {
  command: string;
  args: string;
} | null {
  if (!server.connection) return null;
  const match = server.connection.match(/^command:\s*(.+)$/);
  if (!match) return null;
  const parts = match[1].trim().split(/\s+/);
  return {
    command: parts[0] || "",
    args: parts.slice(1).join(" "),
  };
}

export function CreateProfileDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createProfile = useProfilesStore((s) => s.createProfile);
  const existingServers = useServersStore((s) => s.servers);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedServers, setSelectedServers] = useState<Set<string>>(
    new Set()
  );
  const [customServers, setCustomServers] = useState<CustomServerRow[]>([]);

  const reset = () => {
    setName("");
    setDescription("");
    setSelectedServers(new Set());
    setCustomServers([]);
    setError(null);
  };

  const toggleServer = (serverName: string) => {
    setSelectedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverName)) {
        next.delete(serverName);
      } else {
        next.add(serverName);
      }
      return next;
    });
  };

  const updateCustomServer = (
    index: number,
    field: keyof CustomServerRow,
    value: string
  ) => {
    const next = [...customServers];
    next[index] = { ...next[index], [field]: value };
    setCustomServers(next);
  };

  // Only show STDIO servers that have parseable connection info
  const pickableServers = existingServers.filter(
    (s) => s.type === "STDIO" && parseConnection(s)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Build server list from selected existing + custom entries
    const servers: Array<{
      name: string;
      command: string;
      args: string[];
      description?: string;
    }> = [];

    // Add selected existing servers
    for (const serverName of selectedServers) {
      const srv = existingServers.find((s) => s.name === serverName);
      if (!srv) continue;
      const parsed = parseConnection(srv);
      if (!parsed) continue;
      servers.push({
        name: srv.name,
        command: parsed.command,
        args: parsed.args
          .split(/\s+/)
          .filter(Boolean),
        description: srv.description || undefined,
      });
    }

    // Add valid custom servers
    for (const cs of customServers) {
      if (cs.name.trim() && cs.command.trim()) {
        servers.push({
          name: cs.name.trim(),
          command: cs.command.trim(),
          args: cs.args
            .split(/[,\s]+/)
            .map((a) => a.trim())
            .filter(Boolean),
          description: cs.description.trim() || undefined,
        });
      }
    }

    if (servers.length === 0) {
      setError("Select at least one existing server or add a custom one.");
      return;
    }

    setLoading(true);
    try {
      await createProfile({ name, description, servers });
      toast.success(`Profile "${name}" created`);
      setOpen(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Failed to create profile", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-discord-blurple hover:bg-discord-blurple/80">
          <Plus className="mr-2 h-4 w-4" />
          New Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-discord-bg-sidebar sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-discord-text-primary">
            Create Custom Profile
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs text-discord-text-muted">
              Name *
            </label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-profile"
              pattern="[a-zA-Z0-9_-]+"
              className="bg-discord-bg-darkest"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs text-discord-text-muted">
              Description *
            </label>
            <Input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this profile does"
              className="bg-discord-bg-darkest"
            />
          </div>

          {/* Pick from existing servers */}
          {pickableServers.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-discord-text-muted">
                Select Existing Servers
              </label>
              <div className="space-y-1 rounded-md border border-border bg-discord-bg-darkest p-2">
                {pickableServers.map((srv) => {
                  const selected = selectedServers.has(srv.name);
                  const parsed = parseConnection(srv);
                  return (
                    <button
                      key={srv.name}
                      type="button"
                      onClick={() => toggleServer(srv.name)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                        selected
                          ? "bg-discord-blurple/15 text-discord-text-primary"
                          : "text-discord-text-secondary hover:bg-discord-bg-elevated"
                      }`}
                    >
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-discord-blurple bg-discord-blurple"
                            : "border-discord-text-muted"
                        }`}
                      >
                        {selected && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{srv.name}</span>
                        {srv.description && (
                          <span className="ml-2 text-discord-text-muted">
                            — {srv.description}
                          </span>
                        )}
                        {parsed && (
                          <p className="truncate text-[10px] text-discord-text-muted">
                            {parsed.command} {parsed.args}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedServers.size > 0 && (
                <p className="mt-1 text-[10px] text-discord-text-muted">
                  {selectedServers.size} server{selectedServers.size !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          )}

          {/* Custom servers (manual entry) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-discord-text-muted">
                Custom Servers
              </label>
              <button
                type="button"
                onClick={() =>
                  setCustomServers([...customServers, { ...emptyServer }])
                }
                className="text-xs text-discord-blurple hover:underline"
              >
                + Add Custom
              </button>
            </div>
            {customServers.length === 0 && (
              <p className="text-[10px] text-discord-text-muted">
                Add servers not yet in your swarm
              </p>
            )}
            <div className="space-y-3">
              {customServers.map((srv, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-discord-bg-darkest p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-discord-text-secondary">
                      Custom Server {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomServers(
                          customServers.filter((_, j) => j !== i)
                        )
                      }
                      className="text-discord-text-muted hover:text-discord-red"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={srv.name}
                      onChange={(e) =>
                        updateCustomServer(i, "name", e.target.value)
                      }
                      placeholder="Server name *"
                      className="bg-discord-bg-sidebar text-xs"
                    />
                    <Input
                      value={srv.command}
                      onChange={(e) =>
                        updateCustomServer(i, "command", e.target.value)
                      }
                      placeholder="Command * (npx, uvx...)"
                      className="bg-discord-bg-sidebar text-xs"
                    />
                    <Input
                      value={srv.args}
                      onChange={(e) =>
                        updateCustomServer(i, "args", e.target.value)
                      }
                      placeholder="Args (space separated)"
                      className="bg-discord-bg-sidebar text-xs"
                    />
                    <Input
                      value={srv.description}
                      onChange={(e) =>
                        updateCustomServer(i, "description", e.target.value)
                      }
                      placeholder="Description"
                      className="bg-discord-bg-sidebar text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-discord-red">{error}</p>}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-discord-blurple hover:bg-discord-blurple/80"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Profile
              </>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Pencil, X, Loader2, Save } from "lucide-react";
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
import { useServersStore } from "@/lib/stores/servers";
import type { ServerInfo } from "@/lib/types";

interface EditServerDialogProps {
  server: ServerInfo;
}

/** Parse "command: npx -y @foo/bar" into { command, args } */
function parseConnection(connection?: string): {
  command: string;
  args: string;
  url: string;
} {
  if (!connection) return { command: "", args: "", url: "" };
  if (connection.startsWith("command: ")) {
    const parts = connection.slice("command: ".length).trim().split(/\s+/);
    return { command: parts[0] || "", args: parts.slice(1).join(" "), url: "" };
  }
  if (connection.startsWith("url: ")) {
    return { command: "", args: "", url: connection.slice("url: ".length).trim() };
  }
  return { command: "", args: "", url: "" };
}

export function EditServerDialog({ server }: EditServerDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateServer = useServersStore((s) => s.updateServer);

  const parsed = parseConnection(server.connection);

  const [command, setCommand] = useState(parsed.command);
  const [args, setArgs] = useState(parsed.args);
  const [url, setUrl] = useState(parsed.url);
  const [description, setDescription] = useState(server.description || "");
  const [stateful, setStateful] = useState(server.stateful || false);
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  // Reset fields when dialog opens
  useEffect(() => {
    if (open) {
      const p = parseConnection(server.connection);
      setCommand(p.command);
      setArgs(p.args);
      setUrl(p.url);
      setDescription(server.description || "");
      setStateful(server.stateful || false);
      setEnvVars([]);
      setError(null);
    }
  }, [open, server]);

  const isStdio = server.type === "STDIO";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const params: Record<string, unknown> = { name: server.name };

      if (isStdio) {
        params.command = command;
        params.args = args
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        params.url = url;
      }

      if (description !== (server.description || "")) {
        params.description = description;
      }

      if (stateful !== (server.stateful || false)) {
        params.stateful = stateful;
      }

      if (envVars.length > 0) {
        params.env = Object.fromEntries(
          envVars.filter((e) => e.key).map((e) => [e.key, e.value])
        );
      }

      await updateServer(params);
      toast.success(`Server "${server.name}" updated`);
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Failed to update server", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-discord-text-muted hover:text-discord-text-primary"
          title="Edit server config"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-discord-bg-sidebar sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-discord-text-primary">
            Edit Server: {server.name}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* STDIO fields */}
          {isStdio && (
            <>
              <div>
                <label className="mb-1 block text-xs text-discord-text-muted">
                  Command
                </label>
                <Input
                  required
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx, uvx, node..."
                  className="bg-discord-bg-darkest"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-discord-text-muted">
                  Arguments
                </label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="space separated arguments"
                  className="bg-discord-bg-darkest"
                />
              </div>
            </>
          )}

          {/* URL field for SSE/HTTP */}
          {!isStdio && (
            <div>
              <label className="mb-1 block text-xs text-discord-text-muted">
                URL
              </label>
              <Input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3001/mcp"
                className="bg-discord-bg-darkest"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs text-discord-text-muted">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this server does"
              className="bg-discord-bg-darkest"
            />
          </div>

          {/* Env vars */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-discord-text-muted">
                Environment Variables
              </label>
              <button
                type="button"
                onClick={() =>
                  setEnvVars([...envVars, { key: "", value: "" }])
                }
                className="text-xs text-discord-blurple hover:underline"
              >
                + Add
              </button>
            </div>
            {envVars.map((env, i) => (
              <div key={i} className="mb-1 flex items-center gap-2">
                <Input
                  value={env.key}
                  onChange={(e) => {
                    const next = [...envVars];
                    next[i] = { ...next[i], key: e.target.value };
                    setEnvVars(next);
                  }}
                  placeholder="KEY"
                  className="flex-1 bg-discord-bg-darkest"
                />
                <Input
                  value={env.value}
                  onChange={(e) => {
                    const next = [...envVars];
                    next[i] = { ...next[i], value: e.target.value };
                    setEnvVars(next);
                  }}
                  placeholder="value"
                  className="flex-1 bg-discord-bg-darkest"
                />
                <button
                  type="button"
                  onClick={() =>
                    setEnvVars(envVars.filter((_, j) => j !== i))
                  }
                  className="text-discord-text-muted hover:text-discord-red"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Stateful */}
          <label className="flex items-center gap-2 text-sm text-discord-text-secondary">
            <input
              type="checkbox"
              checked={stateful}
              onChange={(e) => setStateful(e.target.checked)}
              className="rounded"
            />
            Stateful (per-session isolation)
          </label>

          {error && <p className="text-xs text-discord-red">{error}</p>}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-discord-blurple hover:bg-discord-blurple/80"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save & Restart
              </>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
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
import type { AddServerParams } from "@/lib/types";

export function AddServerDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addServer = useServersStore((s) => s.addServer);

  const [name, setName] = useState("");
  const [type, setType] = useState<AddServerParams["type"]>("STDIO");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [stateful, setStateful] = useState(false);
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);

  const reset = () => {
    setName("");
    setType("STDIO");
    setCommand("");
    setArgs("");
    setUrl("");
    setDescription("");
    setStateful(false);
    setEnvVars([]);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const config: AddServerParams = {
        name,
        type,
        ...(type === "STDIO" && {
          command,
          args: args
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
        ...((type === "SSE" || type === "STREAMABLE_HTTP") && { url }),
        ...(description && { description }),
        stateful,
        ...(envVars.length > 0 && {
          env: Object.fromEntries(
            envVars.filter((e) => e.key).map((e) => [e.key, e.value])
          ),
        }),
      };

      await addServer(config);
      toast.success(`Server "${name}" added successfully`);
      setOpen(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Failed to add server", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-discord-blurple hover:bg-discord-blurple/80">
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-discord-bg-sidebar sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-discord-text-primary">
            Add MCP Server
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
              placeholder="my-server"
              pattern="[a-zA-Z0-9_-]+"
              className="bg-discord-bg-darkest"
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs text-discord-text-muted">
              Type *
            </label>
            <select
              value={type}
              onChange={(e) =>
                setType(e.target.value as AddServerParams["type"])
              }
              className="w-full rounded-md border border-border bg-discord-bg-darkest px-3 py-2 text-sm text-discord-text-primary"
            >
              <option value="STDIO">STDIO</option>
              <option value="SSE">SSE</option>
              <option value="STREAMABLE_HTTP">Streamable HTTP</option>
            </select>
          </div>

          {/* STDIO fields */}
          {type === "STDIO" && (
            <>
              <div>
                <label className="mb-1 block text-xs text-discord-text-muted">
                  Command *
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
                  placeholder="mcp-server-fetch (space or comma separated)"
                  className="bg-discord-bg-darkest"
                />
              </div>
            </>
          )}

          {/* URL field */}
          {(type === "SSE" || type === "STREAMABLE_HTTP") && (
            <div>
              <label className="mb-1 block text-xs text-discord-text-muted">
                URL *
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
                onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
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
                  onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}
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

          {error && (
            <p className="text-xs text-discord-red">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-discord-blurple hover:bg-discord-blurple/80"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add Server
              </>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

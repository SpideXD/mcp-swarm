"use client";

import { useState, useEffect, useMemo } from "react";
import { Play, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToolsStore } from "@/lib/stores/tools";
import type { ToolInfo } from "@/lib/types";

interface ToolExecutorProps {
  tool: ToolInfo;
}

/**
 * Generate an example JSON object from parsed parameter lines.
 * Parameter format: - `paramName`: type (required) - description
 */
function generateExample(schema: string | undefined): string {
  if (!schema) return "{}";
  const example: Record<string, unknown> = {};
  const lines = schema.split("\n");

  for (const line of lines) {
    // Match: - `paramName`: type (required/optional) - description
    const match = line.match(
      /^- `(.+?)`:\s*(\w+)(?:\s*\((required|optional)\))?(?:\s*-\s*(.+))?/
    );
    if (!match) continue;
    const [, name, type] = match;

    switch (type.toLowerCase()) {
      case "string":
        example[name] = "";
        break;
      case "number":
      case "integer":
        example[name] = 0;
        break;
      case "boolean":
        example[name] = false;
        break;
      case "object":
        example[name] = {};
        break;
      case "array":
        example[name] = [];
        break;
      default:
        example[name] = "";
    }
  }

  return JSON.stringify(example, null, 2);
}

export function ToolExecutor({ tool }: ToolExecutorProps) {
  const exampleJson = useMemo(() => generateExample(tool.schema), [tool.schema]);
  const [argsJson, setArgsJson] = useState(exampleJson);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const callTool = useToolsStore((s) => s.callTool);

  // Reset state when tool changes
  useEffect(() => {
    setArgsJson(exampleJson);
    setResult(null);
    setError(null);
    setLoading(false);
  }, [tool.name, tool.server, exampleJson]);

  const handleExecute = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsJson);
      } catch {
        setError("Invalid JSON in arguments. Check syntax and try again.");
        setLoading(false);
        return;
      }
      const res = await callTool(tool.server, tool.name, args);
      setResult(res);
      toast.success("Tool executed successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Tool execution failed", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyExample = () => {
    navigator.clipboard.writeText(exampleJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tool header */}
      <div className="border-b border-border p-4">
        <h3 className="font-semibold text-discord-text-primary">{tool.name}</h3>
        <p className="mt-1 text-xs text-discord-text-muted">
          Server: {tool.server}
        </p>
        <p className="mt-1 text-sm text-discord-text-secondary">
          {tool.description}
        </p>
      </div>

      {/* Parameters + Example */}
      {tool.schema && (
        <div className="border-b border-border p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-discord-text-muted">
              Parameters
            </p>
            <button
              onClick={handleCopyExample}
              className="flex items-center gap-1 text-xs text-discord-blurple hover:underline"
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? "Copied" : "Copy example"}
            </button>
          </div>
          <div className="space-y-1 rounded bg-discord-bg-darkest p-2">
            {tool.schema.split("\n").map((line, i) => {
              const match = line.match(
                /^- `(.+?)`:\s*(\w+)(?:\s*\((required|optional)\))?(?:\s*-\s*(.+))?/
              );
              if (!match) return null;
              const [, name, type, req, desc] = match;
              return (
                <div key={i} className="text-xs">
                  <span className="font-mono text-discord-blurple">{name}</span>
                  <span className="ml-1 text-discord-text-muted">{type}</span>
                  {req === "required" && (
                    <span className="ml-1 text-discord-red">*</span>
                  )}
                  {desc && (
                    <span className="ml-2 text-discord-text-muted">
                      — {desc}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Args input */}
      <div className="border-b border-border p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-discord-text-muted">
          Arguments (JSON)
        </p>
        <textarea
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          className="w-full rounded border border-border bg-discord-bg-darkest p-2 font-mono text-xs text-discord-text-primary"
          rows={Math.min(Math.max(argsJson.split("\n").length, 3), 10)}
          spellCheck={false}
        />
        <Button
          onClick={handleExecute}
          disabled={loading}
          size="sm"
          className="mt-2 bg-discord-blurple hover:bg-discord-blurple/80"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Execute
        </Button>
      </div>

      {/* Result */}
      <div className="flex-1 p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-discord-text-muted">
          Result
        </p>
        {error && (
          <div className="rounded bg-discord-red/10 p-3 text-xs text-discord-red">
            {error}
          </div>
        )}
        {result !== null && (
          <ScrollArea className="h-64 rounded bg-discord-bg-darkest p-3">
            <pre className="whitespace-pre-wrap text-xs text-discord-text-secondary">
              {result}
            </pre>
          </ScrollArea>
        )}
        {!error && result === null && !loading && (
          <p className="text-xs text-discord-text-muted">
            Execute the tool to see results
          </p>
        )}
      </div>
    </div>
  );
}

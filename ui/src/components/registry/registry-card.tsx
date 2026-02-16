"use client";

import { ExternalLink, Plus, Loader2, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RegistryResult } from "@/lib/types";

interface RegistryCardProps {
  result: RegistryResult;
  onAdd: (result: RegistryResult) => void;
  isAdding?: boolean;
}

const sourceColors: Record<string, string> = {
  registry: "border-discord-blurple/40 text-discord-blurple",
  npm: "border-red-500/40 text-red-400",
  smithery: "border-purple-500/40 text-purple-400",
};

export function RegistryCard({ result, onAdd, isAdding }: RegistryCardProps) {
  const hasInstall = !!result.installCommand;

  return (
    <Card className="flex flex-col border-0 bg-discord-bg-sidebar">
      <CardContent className="flex flex-1 flex-col p-4">
        {/* Header */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-discord-text-primary">
                {result.name}
              </h3>
              {result.source && (
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[9px] px-1.5 py-0 ${sourceColors[result.source] || "border-border text-discord-text-muted"}`}
                >
                  {result.source}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {result.version && (
                <span className="text-[10px] text-discord-text-muted">
                  {result.version}
                </span>
              )}
              {result.downloads && (
                <span className="flex items-center gap-0.5 text-[10px] text-discord-text-muted">
                  <Download className="h-2.5 w-2.5" />
                  {result.downloads}
                </span>
              )}
            </div>
          </div>
          {result.repository && (
            <a
              href={result.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-discord-text-muted hover:text-discord-blurple"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {/* Description */}
        <p className="mb-3 line-clamp-2 text-xs text-discord-text-secondary">
          {result.description || "No description"}
        </p>

        {/* Install command */}
        {result.installCommand && (
          <div className="mb-3">
            <code className="block truncate rounded bg-discord-bg-darkest px-2 py-1 text-[11px] text-discord-text-secondary">
              {result.installCommand}
            </code>
          </div>
        )}

        {/* Env vars */}
        {result.envVars && result.envVars.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {result.envVars.map((env) => (
              <Badge
                key={env.name}
                variant="outline"
                className={`text-[10px] ${
                  env.required
                    ? "border-discord-yellow/30 text-discord-yellow"
                    : "border-border text-discord-text-muted"
                }`}
              >
                {env.name}
                {env.required && " *"}
              </Badge>
            ))}
          </div>
        )}

        {/* Spacer + action button at bottom */}
        <div className="mt-auto flex justify-end pt-2">
          <Button
            size="sm"
            onClick={() => onAdd(result)}
            disabled={isAdding || !hasInstall}
            className={
              hasInstall
                ? "bg-discord-blurple hover:bg-discord-blurple/80"
                : "bg-discord-bg-tertiary text-discord-text-muted cursor-not-allowed"
            }
            title={!hasInstall ? "No install command — add manually via Servers page" : undefined}
          >
            {isAdding ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3 w-3" />
            )}
            {isAdding ? "Adding..." : hasInstall ? "Add to Swarm" : "Manual Setup"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

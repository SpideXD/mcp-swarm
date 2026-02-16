"use client";

import { useState } from "react";
import { Play, Square, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/servers/status-badge";
import { useProfilesStore } from "@/lib/stores/profiles";
import type { ProfileInfo } from "@/lib/types";

interface ProfileCardProps {
  profile: ProfileInfo;
}

export function ProfileCard({ profile }: ProfileCardProps) {
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const activateProfile = useProfilesStore((s) => s.activateProfile);
  const deactivateProfile = useProfilesStore((s) => s.deactivateProfile);
  const deleteProfile = useProfilesStore((s) => s.deleteProfile);

  const isActive = profile.status === "active";
  const isCustom = profile.source === "custom";

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (isActive) {
        await deactivateProfile(profile.name);
        toast.success(`Profile "${profile.name}" deactivated`);
      } else {
        await activateProfile(profile.name);
        toast.success(`Profile "${profile.name}" activated`);
      }
    } catch (err) {
      toast.error(
        `Failed to ${isActive ? "deactivate" : "activate"} "${profile.name}"`,
        { description: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setDeleting(true);
    try {
      await deleteProfile(profile.name);
      toast.success(`Profile "${profile.name}" deleted`);
    } catch (err) {
      toast.error(`Failed to delete "${profile.name}"`, {
        description: err instanceof Error ? err.message : String(err),
      });
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const borderColor =
    profile.status === "active"
      ? "border-l-discord-green"
      : profile.status === "partial"
        ? "border-l-discord-yellow"
        : "border-l-border";

  return (
    <Card
      className={`flex flex-col border-0 border-l-2 bg-discord-bg-sidebar ${borderColor}`}
    >
      <CardContent className="flex flex-1 flex-col p-4">
        {/* Header: name + source badge + status badge */}
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate font-semibold text-discord-text-primary">
              {profile.name}
            </h3>
            <Badge
              className={`shrink-0 text-[10px] ${
                isCustom
                  ? "bg-discord-blurple/20 text-discord-blurple"
                  : "bg-discord-bg-elevated text-discord-text-muted"
              }`}
            >
              {isCustom ? "custom" : "builtin"}
            </Badge>
          </div>
          <Badge
            className={`shrink-0 text-[10px] ${
              profile.status === "active"
                ? "bg-discord-green/20 text-discord-green"
                : profile.status === "partial"
                  ? "bg-discord-yellow/20 text-discord-yellow"
                  : "bg-discord-bg-elevated text-discord-text-muted"
            }`}
          >
            {profile.status === "active"
              ? "Active"
              : profile.status === "partial"
                ? `${profile.activeCount}/${profile.totalCount}`
                : "Inactive"}
          </Badge>
        </div>

        {/* Description */}
        {profile.description && (
          <p className="mb-3 text-xs text-discord-text-muted">
            {profile.description}
          </p>
        )}

        {/* Server list */}
        <div className="mb-3 flex-1 space-y-1">
          {profile.servers.map((srv) => (
            <div
              key={srv.name}
              className="flex items-center gap-2 text-xs text-discord-text-secondary"
            >
              <StatusBadge
                status={
                  srv.status === "running" || srv.status === "connected"
                    ? "connected"
                    : srv.status === "error"
                      ? "error"
                      : srv.status === "connecting"
                        ? "connecting"
                        : "stopped"
                }
                showLabel={false}
              />
              <span className="truncate font-medium">{srv.name}</span>
            </div>
          ))}
        </div>

        {/* Actions — bottom right */}
        <div className="flex justify-end gap-2 pt-1">
          {/* Delete button — only for custom profiles */}
          {isCustom && (
            <Button
              size="sm"
              disabled={deleting}
              onClick={handleDelete}
              className={
                confirmingDelete
                  ? "bg-discord-red/20 text-discord-red hover:bg-discord-red/30"
                  : "bg-discord-bg-elevated text-discord-text-muted hover:text-discord-red"
              }
            >
              {deleting ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3 w-3" />
              )}
              {confirmingDelete ? "Confirm?" : "Delete"}
            </Button>
          )}

          <Button
            size="sm"
            disabled={loading}
            onClick={handleToggle}
            className={
              isActive
                ? "bg-discord-red/20 text-discord-red hover:bg-discord-red/30"
                : "bg-discord-green/20 text-discord-green hover:bg-discord-green/30"
            }
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : isActive ? (
              <Square className="mr-1.5 h-3 w-3" />
            ) : (
              <Play className="mr-1.5 h-3 w-3" />
            )}
            {loading
              ? isActive
                ? "Stopping..."
                : "Starting..."
              : isActive
                ? "Deactivate"
                : "Activate"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

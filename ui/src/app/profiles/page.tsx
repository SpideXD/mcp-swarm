"use client";

import { useEffect } from "react";
import { ProfileList } from "@/components/profiles/profile-list";
import { CreateProfileDialog } from "@/components/profiles/create-profile-dialog";
import { useConnectionStore } from "@/lib/stores/connection";
import { useProfilesStore } from "@/lib/stores/profiles";

export default function ProfilesPage() {
  const connected = useConnectionStore((s) => s.connected);
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles);

  useEffect(() => {
    if (connected) fetchProfiles();
  }, [connected, fetchProfiles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-discord-text-primary">
            Profiles
          </h2>
          <p className="text-sm text-discord-text-muted">
            Server groups for common workflows
          </p>
        </div>
        {connected && <CreateProfileDialog />}
      </div>

      {!connected ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-discord-text-muted">
            Connect to a swarm server from the Dashboard to view profiles.
          </p>
        </div>
      ) : (
        <ProfileList />
      )}
    </div>
  );
}

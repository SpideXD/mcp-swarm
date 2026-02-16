"use client";

import { useProfilesStore } from "@/lib/stores/profiles";
import { ProfileCard } from "./profile-card";

export function ProfileList() {
  const profiles = useProfilesStore((s) => s.profiles);
  const loading = useProfilesStore((s) => s.loading);

  if (loading && profiles.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-discord-text-muted">
        Loading profiles...
      </p>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-discord-text-secondary">
          No profiles configured
        </p>
        <p className="mt-1 text-xs text-discord-text-muted">
          Add profiles to profiles.json in the swarm directory.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {profiles.map((profile) => (
        <ProfileCard key={profile.name} profile={profile} />
      ))}
    </div>
  );
}

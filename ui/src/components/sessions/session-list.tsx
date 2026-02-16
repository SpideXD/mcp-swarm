"use client";

import { useSessionsStore } from "@/lib/stores/sessions";

export function SessionList() {
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const error = useSessionsStore((s) => s.error);

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-discord-text-muted">
        Loading sessions...
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-discord-red/10 p-4 text-center">
        <p className="text-sm text-discord-red">
          Failed to load sessions: {error}
        </p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-discord-text-muted">
          No active sessions
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-discord-bg-sidebar text-xs uppercase text-discord-text-muted">
            <th className="px-4 py-2 text-left">Session ID</th>
            <th className="px-4 py-2 text-left">Created</th>
            <th className="px-4 py-2 text-left">Last Active</th>
            <th className="px-4 py-2 text-left">Idle</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              className="border-b border-border last:border-0 hover:bg-discord-bg-elevated"
            >
              <td className="px-4 py-2 font-mono text-xs text-discord-text-primary">
                {session.id.slice(0, 12)}...
              </td>
              <td className="px-4 py-2 text-xs text-discord-text-secondary">
                {new Date(session.createdAt).toLocaleTimeString()}
              </td>
              <td className="px-4 py-2 text-xs text-discord-text-secondary">
                {new Date(session.lastActiveAt).toLocaleTimeString()}
              </td>
              <td className="px-4 py-2 text-xs text-discord-text-muted">
                {formatIdle(session.idle)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatIdle(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

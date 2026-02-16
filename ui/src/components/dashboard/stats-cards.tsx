"use client";

import { Server, Wifi, Users, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useServersStore } from "@/lib/stores/servers";
import type { HealthInfo } from "@/lib/types";

interface StatsCardsProps {
  health: HealthInfo | null;
}

export function StatsCards({ health }: StatsCardsProps) {
  const servers = useServersStore((s) => s.servers);
  const connectedCount = servers.filter(
    (s) => s.status === "connected"
  ).length;

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const stats = [
    {
      label: "Total Servers",
      value: servers.length,
      icon: Server,
      color: "text-discord-blurple",
    },
    {
      label: "Connected",
      value: connectedCount,
      icon: Wifi,
      color: "text-discord-green",
    },
    {
      label: "Sessions",
      value: health?.sessions ?? 0,
      icon: Users,
      color: "text-discord-yellow",
    },
    {
      label: "Uptime",
      value: health ? formatUptime(health.uptime) : "--",
      icon: Clock,
      color: "text-discord-text-secondary",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="border-0 bg-discord-bg-sidebar">
            <CardContent className="flex items-center gap-3 p-3">
              <Icon className={`h-6 w-6 shrink-0 ${stat.color}`} />
              <div className="min-w-0">
                <p className="truncate text-xl font-bold text-discord-text-primary">
                  {stat.value}
                </p>
                <p className="text-[11px] text-discord-text-muted">
                  {stat.label}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

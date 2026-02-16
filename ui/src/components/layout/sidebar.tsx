"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Server,
  UserCog,
  BookOpen,
  Wrench,
  Clock,
  Activity,
  Settings,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/lib/stores/connection";

const channels = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Servers", href: "/servers", icon: Server },
  { name: "Profiles", href: "/profiles", icon: UserCog },
  { name: "Registry", href: "/registry", icon: BookOpen },
  { name: "Tools", href: "/tools", icon: Wrench },
  { name: "Sessions", href: "/sessions", icon: Clock },
  { name: "Activity", href: "/activity", icon: Activity },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const connected = useConnectionStore((s) => s.connected);

  return (
    <aside className="flex h-full w-60 flex-col bg-discord-bg-sidebar">
      {/* Header */}
      <div className="flex h-12 items-center border-b border-border px-4 font-semibold shadow-sm">
        MCP SWARM
      </div>

      {/* Channels */}
      <ScrollArea className="flex-1 px-2 py-2">
        <p className="mb-1 px-2 text-xs font-semibold uppercase text-discord-text-muted">
          Channels
        </p>
        {channels.map((channel) => {
          const isActive =
            pathname === channel.href ||
            (channel.href !== "/" && pathname.startsWith(channel.href));
          const Icon = channel.icon;

          return (
            <Link
              key={channel.name}
              href={channel.href}
              className={cn(
                "group relative mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-discord-text-secondary transition-colors hover:bg-discord-bg-elevated hover:text-discord-text-primary",
                isActive &&
                  "bg-discord-bg-elevated text-discord-text-primary"
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-sm bg-discord-text-primary" />
              )}
              <Icon className="h-4 w-4 shrink-0 text-discord-text-muted" />
              {channel.name}
            </Link>
          );
        })}
      </ScrollArea>

      {/* Connection status */}
      <Separator className="bg-border" />
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-discord-text-muted">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            connected ? "bg-discord-green" : "bg-discord-red"
          )}
        />
        {connected ? "Connected" : "Disconnected"}
      </div>
    </aside>
  );
}

"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useServersStore } from "@/lib/stores/servers";

const MAX_VISIBLE = 5;

export function NavRail() {
  const pathname = usePathname();
  const servers = useServersStore((s) => s.servers);

  // Only show connected/running servers in the rail
  const connectedServers = useMemo(
    () => servers.filter((s) => s.status === "connected"),
    [servers]
  );
  const visible = connectedServers.slice(0, MAX_VISIBLE);
  const overflow = connectedServers.length - MAX_VISIBLE;

  return (
    <nav className="flex h-full w-[72px] flex-col items-center gap-2 bg-discord-bg-darkest py-3">
      {/* Home / Dashboard */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-[24px] bg-discord-bg-main text-sm font-semibold transition-all hover:rounded-[16px] hover:bg-discord-blurple",
              pathname === "/" && "rounded-[16px] bg-discord-blurple"
            )}
          >
            SW
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Dashboard</TooltipContent>
      </Tooltip>

      {connectedServers.length > 0 && (
        <Separator className="mx-auto w-8 bg-discord-bg-elevated" />
      )}

      {/* Connected server icons */}
      {visible.map((server) => (
        <Tooltip key={server.name}>
          <TooltipTrigger asChild>
            <Link
              href="/servers"
              className="relative flex h-12 w-12 items-center justify-center rounded-[24px] bg-discord-bg-main text-xs font-semibold transition-all hover:rounded-[16px] hover:bg-discord-bg-elevated"
            >
              {server.name.slice(0, 2).toUpperCase()}
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-discord-bg-darkest bg-discord-green" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{server.name}</TooltipContent>
        </Tooltip>
      ))}

      {/* Overflow indicator */}
      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/servers"
              className="flex h-12 w-12 items-center justify-center rounded-[24px] bg-discord-bg-main text-xs text-discord-text-muted transition-all hover:rounded-[16px] hover:bg-discord-bg-elevated"
            >
              +{overflow}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            {overflow} more server{overflow > 1 ? "s" : ""}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Add server */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/servers"
            className="flex h-12 w-12 items-center justify-center rounded-[24px] bg-discord-bg-main text-discord-green transition-all hover:rounded-[16px] hover:bg-discord-green hover:text-white"
          >
            <Plus className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Add Server</TooltipContent>
      </Tooltip>
    </nav>
  );
}

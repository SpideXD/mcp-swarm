"use client";

import { usePathname } from "next/navigation";
import { Hash } from "lucide-react";

const routeNames: Record<string, string> = {
  "/": "Dashboard",
  "/servers": "Servers",
  "/profiles": "Profiles",
  "/registry": "Registry",
  "/tools": "Tools",
  "/sessions": "Sessions",
  "/activity": "Activity",
  "/settings": "Settings",
};

export function Header() {
  const pathname = usePathname();
  const title = routeNames[pathname] ?? "Dashboard";

  return (
    <header className="flex h-12 items-center border-b border-border bg-discord-bg-main px-4 shadow-sm">
      <Hash className="mr-2 h-5 w-5 text-discord-text-muted" />
      <h1 className="text-sm font-semibold text-discord-text-primary">
        {title}
      </h1>
    </header>
  );
}

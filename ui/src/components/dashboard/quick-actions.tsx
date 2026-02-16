"use client";

import Link from "next/link";
import { Plus, Search, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary" className="bg-discord-bg-elevated">
        <Link href="/servers">
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Link>
      </Button>
      <Button asChild variant="secondary" className="bg-discord-bg-elevated">
        <Link href="/registry">
          <Search className="mr-2 h-4 w-4" />
          Search Registry
        </Link>
      </Button>
      <Button asChild variant="secondary" className="bg-discord-bg-elevated">
        <Link href="/activity">
          <Activity className="mr-2 h-4 w-4" />
          View Activity
        </Link>
      </Button>
    </div>
  );
}

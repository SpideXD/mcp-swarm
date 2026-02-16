"use client";

import { useEffect, useState, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) return;
    timerRef.current = setTimeout(() => {
      onSearch(query.trim());
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, onSearch]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-discord-text-muted" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search MCP registry... (e.g. 'weather', 'postgres', 'playwright')"
        className="bg-discord-bg-darkest pl-9"
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) onSearch(query.trim());
        }}
      />
    </div>
  );
}

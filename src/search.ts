/**
 * Search module - MCP server discovery via multiple registries.
 *
 * Searches three sources in parallel:
 * 1. Official MCP Registry (registry.modelcontextprotocol.io)
 * 2. npm registry (registry.npmjs.org)
 * 3. Smithery (registry.smithery.ai)
 *
 * Results are deduplicated and merged.
 */

import type { RegistryServer, RegistryResponse } from "./types.js";

// ── Source-tagged result ──────────────────────────────────────────────

export interface TaggedServer extends RegistryServer {
  _source: "registry" | "npm" | "smithery";
  _popularity?: number; // download count or use count for sorting
}

// ── Individual source search functions ────────────────────────────────

/**
 * Search the official MCP Registry API.
 */
async function searchOfficialRegistry(
  query: string,
  limit: number
): Promise<TaggedServer[]> {
  try {
    const fetchLimit = limit * 3; // fetch extra to allow dedup of multi-version entries
    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}&limit=${fetchLimit}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as RegistryResponse;
    const servers = data.servers || [];

    // Deduplicate by name (registry returns multiple versions)
    const byName = new Map<string, TaggedServer>();
    for (const entry of servers) {
      const name = entry.server.name || "unknown";
      byName.set(name, { ...entry, _source: "registry" });
    }
    return Array.from(byName.values()).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Search npm registry for MCP-related packages.
 */
async function searchNpm(
  query: string,
  limit: number
): Promise<TaggedServer[]> {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query + " mcp")}&size=${limit}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { objects?: NpmResult[] };

    return (data.objects || [])
      .filter((o) => {
        const name = (o.package?.name || "").toLowerCase();
        const keywords = (o.package?.keywords || []).map((k: string) =>
          k.toLowerCase()
        );
        const desc = (o.package?.description || "").toLowerCase();
        // Only include if "mcp" appears in name, keywords, or description
        return (
          name.includes("mcp") ||
          keywords.some((k: string) => k.includes("mcp")) ||
          desc.includes("mcp")
        );
      })
      .map((o) => ({
        server: {
          name: o.package.name,
          description: o.package.description || "",
          repository: o.package.links?.repository
            ? { url: o.package.links.repository }
            : undefined,
          version: o.package.version,
          packages: [
            {
              registryType: "npm" as const,
              identifier: o.package.name,
              version: o.package.version,
              transport: { type: "stdio" },
            },
          ],
        },
        _source: "npm" as const,
        _popularity: o.downloads?.monthly || 0,
      }));
  } catch {
    return [];
  }
}

interface NpmResult {
  package: {
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    links?: { repository?: string; homepage?: string; npm?: string };
  };
  downloads?: { monthly?: number; weekly?: number };
}

/**
 * Search Smithery registry for MCP servers.
 */
async function searchSmithery(
  query: string,
  limit: number
): Promise<TaggedServer[]> {
  try {
    const url = `https://registry.smithery.ai/servers?q=${encodeURIComponent(query)}&pageSize=${limit}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { servers?: SmitheryResult[] };

    return (data.servers || []).map((s) => ({
      server: {
        name: s.qualifiedName || s.displayName || "unknown",
        description: s.description || "",
        repository: s.homepage
          ? { url: s.homepage }
          : undefined,
        version: undefined,
        packages: [], // Smithery list doesn't include install info
      },
      _source: "smithery" as const,
      _popularity: s.useCount || 0,
    }));
  } catch {
    return [];
  }
}

interface SmitheryResult {
  qualifiedName?: string;
  displayName?: string;
  description?: string;
  iconUrl?: string;
  verified?: boolean;
  useCount?: number;
  homepage?: string;
}

// ── Main search: aggregate all sources ────────────────────────────────

/**
 * Search all registries in parallel, merge and deduplicate results.
 */
export async function searchRegistry(
  query: string,
  limit: number = 10
): Promise<TaggedServer[]> {
  const [official, npm, smithery] = await Promise.all([
    searchOfficialRegistry(query, limit),
    searchNpm(query, limit),
    searchSmithery(query, limit),
  ]);

  // Merge: official first, then npm, then smithery
  const all = [...official, ...npm, ...smithery];

  // Deduplicate by normalized name.
  // Keep the entry with more data (prefer one with install command).
  const byKey = new Map<string, TaggedServer>();
  for (const entry of all) {
    const key = normalizeServerName(entry.server.name || "");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
    } else {
      // Prefer entry that has install info
      const existingHasInstall = hasInstallInfo(existing);
      const newHasInstall = hasInstallInfo(entry);
      if (!existingHasInstall && newHasInstall) {
        byKey.set(key, entry);
      }
    }
  }

  // Sort by popularity (highest first), then by whether they have install info
  const sorted = Array.from(byKey.values()).sort((a, b) => {
    const aInstall = hasInstallInfo(a) ? 1 : 0;
    const bInstall = hasInstallInfo(b) ? 1 : 0;
    if (aInstall !== bInstall) return bInstall - aInstall;
    return (b._popularity || 0) - (a._popularity || 0);
  });

  return sorted.slice(0, limit);
}

/** Normalize server names for deduplication */
function normalizeServerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@[^/]+\//, "") // remove npm scope
    .replace(/^io\.github\.[^/]+\//, "") // remove registry prefix
    .replace(/^[^/]+\//, "") // remove smithery namespace
    .replace(/[^a-z0-9]/g, ""); // strip non-alphanumeric
}

/** Check if a server entry has install info */
function hasInstallInfo(s: TaggedServer): boolean {
  const pkgs = s.server.packages || [];
  return pkgs.some(
    (p) => p.identifier && (p.registryType === "npm" || p.registryType === "pypi")
  );
}

// ── Format results ────────────────────────────────────────────────────

/**
 * Format registry search results as readable markdown.
 */
export function formatRegistryResults(
  servers: TaggedServer[],
  query: string
): string {
  if (servers.length === 0) {
    return `No MCP servers found for query: "${query}". Try different keywords or broader terms.`;
  }

  const formatted = servers
    .map((entry, i) => {
      const s = entry.server;
      const name = s.name || "Unknown";
      const desc = s.description || "No description";
      const repo = s.repository?.url || "";
      const version = s.version ? ` v${s.version}` : "";
      const source = entry._source || "registry";

      let installHint = "";
      const envVars: string[] = [];

      if (s.packages && s.packages.length > 0) {
        const pkg = s.packages[0];
        if (pkg.registryType === "npm" && pkg.identifier) {
          installHint = `\n   Install: npx -y ${pkg.identifier}`;
        } else if (pkg.registryType === "pypi" && pkg.identifier) {
          installHint = `\n   Install: uvx ${pkg.identifier}`;
        }
        if (pkg.environmentVariables) {
          for (const env of pkg.environmentVariables) {
            if (env.isRequired && env.name) envVars.push(env.name);
          }
        }
      }

      const envNote =
        envVars.length > 0
          ? `\n   Required env: ${envVars.join(", ")}`
          : "";

      const popularity = entry._popularity
        ? `\n   Downloads: ${formatDownloads(entry._popularity)}`
        : "";

      return `${i + 1}. **${name}**${version} [${source}]\n   ${desc}${repo ? `\n   Repository: ${repo}` : ""}${installHint}${envNote}${popularity}`;
    })
    .join("\n\n");

  return `## MCP Server Search Results for "${query}"\n\n${formatted}\n\n---\nTo add a server, use \`add_managed_server\`. For npm packages use command="npx" args=["-y", "package-name"]. For PyPI packages use command="uvx" args=["package-name"].`;
}

/** Format a number as human-readable (e.g. 6070670 → "6.1M/month") */
function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/month`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/month`;
  return `${n}/month`;
}

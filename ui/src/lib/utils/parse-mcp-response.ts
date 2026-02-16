/**
 * Parse markdown-formatted MCP tool responses into typed objects.
 *
 * The MCP swarm tools return text content in markdown format.
 * These parsers extract structured data from those responses.
 *
 * IMPORTANT: These parsers must match the exact output format from
 * mcp-swarm/src/tools.ts and mcp-swarm/src/search.ts.
 */

import type {
  ServerInfo,
  ToolInfo,
  ProfileInfo,
  ProfileServerInfo,
  RegistryResult,
} from "../types";

/** Extract text content from MCP tool result */
export function extractText(
  result: { content: Array<{ type: string; text?: string }> }
): string {
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

/**
 * Parse list_managed_servers response into ServerInfo[].
 *
 * Backend format (tools.ts line 376):
 * Running:  - **name** (TYPE [STATUS]) [stateful] (PID: N): connection - N tools
 * DB-only:  - **name** (TYPE) [stateful] [DB only, not spawned]: connection
 *
 * Status is inside the parens with type: (STDIO), (STDIO [ERROR]), (STDIO [CONNECTING])
 * Connected servers have no status marker: (STDIO)
 */
export function parseServersResponse(text: string): ServerInfo[] {
  const servers: ServerInfo[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match DB-only server first (more specific pattern)
    // Format: - **name** (TYPE) [stateful] [DB only, not spawned]: connection
    const dbMatch = line.match(
      /^- \*\*(.+?)\*\* \((\w+)\)(\s*\[stateful\])?\s*\[DB only, not spawned\]:\s*(.+)$/
    );
    if (dbMatch) {
      const [, name, type, stateful, connection] = dbMatch;
      let description: string | undefined;
      let dbTools = 0;
      if (i + 1 < lines.length && lines[i + 1].startsWith("  ")) {
        i++;
        const sub = lines[i].trim();
        const descToolsMatch = sub.match(/\s-\s(\d+)\s+tools?$/);
        if (descToolsMatch) {
          dbTools = parseInt(descToolsMatch[1], 10);
          description = sub.replace(/\s-\s\d+\s+tools?$/, "").trim();
        } else {
          description = sub;
        }
      }
      servers.push({
        name: name.trim(),
        status: "stopped",
        type: type.trim(),
        pid: null,
        tools: dbTools,
        description,
        stateful: !!stateful,
        connection: connection.trim(),
      });
      continue;
    }

    // Match running server
    // Format: - **name** (TYPE [STATUS]) [stateful] (PID: N): connection - N tools
    // TYPE can be: STDIO, SSE, STREAMABLE_HTTP
    // STATUS (optional): [ERROR], [CONNECTING], etc. Connected has no status.
    const runMatch = line.match(
      /^- \*\*(.+?)\*\* \((\w+)(?:\s*\[(\w+)\])?\)(\s*\[stateful\])?\s*(?:\(PID:\s*(\d+)\))?\s*:\s*(.+)$/
    );
    if (runMatch) {
      const [, name, type, statusStr, stateful, pid, rest] = runMatch;

      let status: ServerInfo["status"] = "connected";
      if (statusStr) {
        const s = statusStr.toLowerCase();
        if (s === "error") status = "error";
        else if (s === "connecting") status = "connecting";
        else if (s === "stopped") status = "stopped";
      }

      // Extract tool count from end: "... - N tools"
      const toolsMatch = rest.match(/\s-\s(\d+)\s+tools?$/);
      const tools = toolsMatch ? parseInt(toolsMatch[1], 10) : 0;
      const connection = rest.replace(/\s-\s\d+\s+tools?$/, "").trim();

      // Check next lines for description/error (indented with 2 spaces)
      // Description line may also contain tool count: "desc - N tools"
      let description: string | undefined;
      let error: string | undefined;
      let descTools = tools; // fallback to count from main line
      while (i + 1 < lines.length && lines[i + 1].startsWith("  ")) {
        i++;
        const sub = lines[i].trim();
        if (sub.startsWith("Error:")) {
          error = sub.slice("Error:".length).trim();
        } else if (!description) {
          // Extract tool count from description line: "Some description - N tools"
          const descToolsMatch = sub.match(/\s-\s(\d+)\s+tools?$/);
          if (descToolsMatch) {
            descTools = parseInt(descToolsMatch[1], 10);
            description = sub.replace(/\s-\s\d+\s+tools?$/, "").trim();
          } else {
            description = sub;
          }
        }
      }

      servers.push({
        name: name.trim(),
        status,
        type: type.trim(),
        pid: pid ? parseInt(pid, 10) : null,
        tools: descTools,
        error,
        description,
        stateful: !!stateful,
        connection,
      });
      continue;
    }
  }

  return servers;
}

/**
 * Parse list_server_tools response into ToolInfo[].
 *
 * Detail mode (single server, tools.ts line 1111-1134):
 *   ## servername (N tools)
 *   - **toolname**: description
 *     Parameters:
 *       - `param`: type (required) - description
 *
 * Summary mode (all servers, tools.ts line 1151-1172):
 *   ## Available Servers (N)
 *   - **servername** [STATUS] (N tools): tool1, tool2, ...
 */
export function parseToolsResponse(text: string): ToolInfo[] {
  const tools: ToolInfo[] = [];
  let currentServer = "";

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect server header: "## servername (N tools)"
    const serverMatch = line.match(/^##\s+(.+?)\s*\(\d+\s+tools?\)/);
    if (serverMatch) {
      currentServer = serverMatch[1].trim();
      continue;
    }

    // Summary mode server line: "- **name** [STATUS] (N tools): tool1, tool2"
    const summaryMatch = line.match(
      /^- \*\*(.+?)\*\*(?:\s*\[\w+\])?\s*\((\d+)\s+tools?\):\s*(.+)/
    );
    if (summaryMatch) {
      const [, server, , toolNames] = summaryMatch;
      const names = toolNames.split(",").map((t) => t.trim()).filter(Boolean);
      for (const name of names) {
        // Strip trailing "..." from truncated lists
        const cleanName = name.replace(/\.\.\.$/,"");
        if (cleanName) {
          tools.push({ server: server.trim(), name: cleanName, description: "" });
        }
      }
      continue;
    }

    // Detail mode tool line: "- **toolname**: description"
    const toolMatch = line.match(/^- \*\*(.+?)\*\*:\s*(.+)/);
    if (toolMatch && currentServer) {
      const toolName = toolMatch[1].trim();
      const description = toolMatch[2].trim();

      // Look ahead for parameters
      const params: string[] = [];
      while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}/)) {
        i++;
        const paramLine = lines[i].trim();
        if (paramLine.startsWith("- `")) {
          params.push(paramLine);
        }
      }

      tools.push({
        server: currentServer,
        name: toolName,
        description,
        schema: params.length > 0 ? params.join("\n") : undefined,
      });
      continue;
    }
  }

  return tools;
}

/**
 * Parse list_profiles response into ProfileInfo[].
 *
 * Backend format (tools.ts line 646-677):
 *   ## Available Profiles
 *
 *   ### profilename [ACTIVE]
 *   description
 *
 *   Servers:
 *   - **servername** [running]: description
 *     `command args`
 *
 *   ### profilename [PARTIAL 2/3]
 *   ...
 */
export function parseProfilesResponse(text: string): ProfileInfo[] {
  const profiles: ProfileInfo[] = [];
  // Split by "### " to get each profile section
  const sections = text.split(/^### /gm).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const headerLine = lines[0] ?? "";

    // Skip non-profile sections (like "## Available Profiles")
    if (headerLine.startsWith("## ") || headerLine.startsWith("---")) continue;

    // Parse header: "profilename [ACTIVE] [builtin]" or "profilename [PARTIAL 2/3] [custom]" or "profilename [builtin]"
    const headerMatch = headerLine.match(
      /^(.+?)(?:\s+\[ACTIVE\]|\s+\[PARTIAL\s+(\d+)\/(\d+)\])?(?:\s+\[(builtin|custom)\])?\s*$/
    );
    if (!headerMatch) continue;

    const name = headerMatch[1].trim();
    if (!name) continue;
    const source = (headerMatch[4] as "builtin" | "custom") || "builtin";

    // Description is typically on the next line
    const description = lines[1]?.trim() ?? "";

    // Parse servers
    const servers: ProfileServerInfo[] = [];
    for (let j = 2; j < lines.length; j++) {
      const line = lines[j];
      // Match: - **servername** [status]: description
      const srvMatch = line.match(
        /^- \*\*(.+?)\*\*\s+\[(\w+)\]:\s*(.+)/
      );
      if (srvMatch) {
        servers.push({
          name: srvMatch[1].trim(),
          status: srvMatch[2].trim(),
          description: srvMatch[3].trim(),
          command: "",
        });
        continue;
      }
      // Match command line: `command args`
      const cmdMatch = line.match(/^\s+`(.+)`/);
      if (cmdMatch && servers.length > 0) {
        servers[servers.length - 1].command = cmdMatch[1].trim();
      }
    }

    const activeCount = servers.filter(
      (s) => s.status === "running" || s.status === "connected"
    ).length;
    const totalCount = servers.length;
    const status =
      activeCount === totalCount && totalCount > 0
        ? "active"
        : activeCount > 0
          ? "partial"
          : "inactive";

    profiles.push({
      name,
      description,
      status,
      activeCount,
      totalCount,
      servers,
      source,
    });
  }

  return profiles;
}

/**
 * Parse search_mcp_registry response into RegistryResult[].
 *
 * Backend format (search.ts line 67):
 *   ## MCP Server Search Results for "query"
 *
 *   1. **name** v1.0
 *      description text here
 *      Repository: https://...
 *      Install: npx -y package-name
 *      Required env: VAR1, VAR2
 *
 *   2. **name2**
 *      ...
 */
export function parseRegistryResponse(text: string): RegistryResult[] {
  const results: RegistryResult[] = [];

  // Split by numbered entries: "N. **name**"
  const entries = text.split(/(?=^\d+\.\s+\*\*)/gm).filter(Boolean);

  for (const entry of entries) {
    // Match: "N. **name** vVersion [source]" or "N. **name** [source]" or without source
    const nameMatch = entry.match(
      /^\d+\.\s+\*\*(.+?)\*\*\s*(v[\d.]+)?\s*(?:\[(\w+)\])?/
    );
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const version = nameMatch[2]?.trim();
    const source = nameMatch[3]?.trim() as RegistryResult["source"];

    // Get all lines after the first
    const lines = entry.split("\n").slice(1);

    let description = "";
    let repository: string | undefined;
    let installCommand: string | undefined;
    let downloads: string | undefined;
    const envVars: RegistryResult["envVars"] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("---") || trimmed.startsWith("To add")) continue;

      if (trimmed.startsWith("Repository:")) {
        repository = trimmed.slice("Repository:".length).trim();
      } else if (trimmed.startsWith("Install:")) {
        installCommand = trimmed.slice("Install:".length).trim();
      } else if (trimmed.startsWith("Downloads:")) {
        downloads = trimmed.slice("Downloads:".length).trim();
      } else if (trimmed.startsWith("Required env:")) {
        const vars = trimmed.slice("Required env:".length).trim();
        for (const v of vars.split(",")) {
          const vName = v.trim();
          if (vName) envVars.push({ name: vName, required: true });
        }
      } else if (!description && !trimmed.startsWith("##")) {
        // First non-special line is the description
        description = trimmed;
      }
    }

    results.push({
      name,
      version,
      description,
      repository,
      installCommand,
      source,
      downloads,
      envVars: envVars.length > 0 ? envVars : undefined,
    });
  }

  return results;
}

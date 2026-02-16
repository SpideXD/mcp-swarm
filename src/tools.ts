/**
 * Tool Registration - All 15 MCP tools extracted from index.ts
 *
 * v4.0: All persistence via SQLite (db.ts).
 * This module provides registerAllTools() which registers all swarm tools
 * on any McpServer instance. This enables creating multiple McpServer instances
 * (for HTTP multi-client mode) that all operate on the same shared ProcessManager.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProcessManager } from "./process-manager.js";
import { searchRegistry, formatRegistryResults, type TaggedServer } from "./search.js";
import * as db from "./db.js";
import { KNOWN_STATEFUL_SERVERS } from "./config.js";
import type {
  ProfilesConfig,
  ServerConfig,
  // RegistryServer imported by search.ts internally
} from "./types.js";

export interface RegisterToolsOptions {
  /** Use callToolQueued instead of callTool for HTTP mode */
  useQueuedCalls?: boolean;
  /** Session ID for stateful server isolation in HTTP mode */
  sessionId?: string;
}

export function registerAllTools(
  mcpServer: McpServer,
  processManager: ProcessManager,
  profilesConfig: ProfilesConfig,
  options?: RegisterToolsOptions
): void {
  const useQueued = options?.useQueuedCalls ?? false;
  const sessionId = options?.sessionId;

  // ============================================================
  // Tool 1: search_mcp_registry
  // ============================================================
  mcpServer.tool(
    "search_mcp_registry",
    `Search the official MCP Registry (registry.modelcontextprotocol.io) for available MCP servers. Use this to discover servers that provide specific capabilities before adding them with add_managed_server.

IMPORTANT: BEFORE saying "I can't do that" or "I don't have access to that", ALWAYS search here first. This searches 2290+ MCP servers that provide capabilities including:

- Real-time data: weather, stocks, crypto, exchange rates, news feeds
- Web: scraping, browser automation (Playwright, Puppeteer), HTTP requests, content extraction
- Databases: PostgreSQL, MySQL, SQLite, MongoDB, Redis, vector databases
- DevOps: Docker, Kubernetes, CI/CD, infrastructure management
- Code: GitHub, GitLab, git operations, code analysis, linting
- Communication: Slack, Discord, email, SMS, webhooks
- Cloud: AWS, Azure, GCP, Cloudflare
- Files: filesystem, S3, Google Drive, PDF, image processing
- AI/ML: embeddings, vector search, model serving
- Monitoring: logging, APM, error tracking, metrics
- Testing: Playwright, Selenium, API testing, load testing

If a user asks for ANY capability not available in your current tools, search here first.`,
    {
      query: z
        .string()
        .describe(
          "Natural language search query describing the capabilities you need"
        ),
    },
    async (params) => {
      try {
        let servers = await searchRegistry(params.query, 10);

        if (servers.length === 0) {
          const keywords = params.query
            .split(/\s+/)
            .filter((w) => w.length > 2);
          if (keywords.length > 1) {
            const seen = new Set<string>();
            const combined: TaggedServer[] = [];
            for (const keyword of keywords) {
              const keywordResults = await searchRegistry(keyword, 5);
              for (const entry of keywordResults) {
                const key = entry.server.name || "";
                if (key && !seen.has(key)) {
                  seen.add(key);
                  combined.push(entry);
                }
              }
              if (combined.length >= 10) break;
            }
            servers = combined.slice(0, 10);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatRegistryResults(servers, params.query),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching registry: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 2: add_managed_server (spawn locally, persist to SQLite)
  // ============================================================
  mcpServer.tool(
    "add_managed_server",
    `Add a new MCP server to the swarm. After adding, the server's tools become available through call_server_tool (no restart needed).

For STDIO servers: provide command and args (e.g., command="uvx", args=["mcp-server-fetch"]).
For SSE servers: provide url (e.g., url="http://localhost:3001/sse").
For Streamable HTTP servers: provide url (e.g., url="http://localhost:3001/mcp").

Server names must match: [a-zA-Z0-9_-]+ (letters, numbers, underscores, hyphens only).`,
    {
      name: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .describe("Server name (alphanumeric, hyphens, underscores only)"),
      type: z
        .enum(["STDIO", "SSE", "STREAMABLE_HTTP"])
        .describe("Server transport type"),
      command: z
        .string()
        .optional()
        .describe(
          "Command to run (required for STDIO type, e.g. 'uvx', 'npx', 'node')"
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("Command arguments (for STDIO type, e.g. ['mcp-server-fetch'])"),
      env: z
        .record(z.string())
        .optional()
        .describe("Environment variables for the server process"),
      url: z
        .string()
        .optional()
        .describe("Server URL (required for SSE and STREAMABLE_HTTP types)"),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of what this server does"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Custom HTTP headers (for SSE/STREAMABLE_HTTP types)"),
      stateful: z
        .boolean()
        .optional()
        .describe(
          "Whether this server is stateful (needs per-session isolation). Auto-detected for known servers like Playwright, Puppeteer, etc."
        ),
    },
    async (params) => {
      try {
        // Validate
        if (params.type === "STDIO" && !params.command) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: STDIO servers require a 'command' parameter.",
              },
            ],
            isError: true,
          };
        }
        if (
          (params.type === "SSE" || params.type === "STREAMABLE_HTTP") &&
          !params.url
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${params.type} servers require a 'url' parameter.`,
              },
            ],
            isError: true,
          };
        }

        // Auto-detect stateful if not explicitly set
        const stateful =
          params.stateful ?? KNOWN_STATEFUL_SERVERS.has(params.name);

        // Step 1: Spawn locally first (immediate feedback)
        const config: ServerConfig = {
          name: params.name,
          type: params.type,
          command: params.command,
          args: params.args || [],
          env: params.env || {},
          url: params.url,
          description: params.description,
          headers: params.headers,
          stateful,
        };

        const managed = await processManager.spawnServer(config);

        if (managed.status === "error") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server **${params.name}** failed to start.\n\n**Error:** ${managed.errorMessage || "Unknown error"}\n\nThis usually means:\n- Wrong package name (command not found)\n- Package doesn't expose a proper MCP server binary\n- Missing required environment variables\n\nUse \`search_mcp_registry\` to find the correct install command, then try again.`,
              },
            ],
            isError: true,
          };
        }

        // Step 2: Persist to SQLite
        try {
          db.upsertServer(config);
        } catch {
          // Non-critical
        }

        const statefulNote = stateful ? " [stateful]" : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully started server **${params.name}**${statefulNote} on host (PID: ${managed.pid}, ${managed.tools.length} tools).\nConfig persisted to SQLite.\n\nUse \`list_server_tools(server_name="${params.name}")\` to see available tools, then \`call_server_tool\` to use them.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 3: remove_managed_server
  // ============================================================
  mcpServer.tool(
    "remove_managed_server",
    "Remove an MCP server by name. Stops the running process and removes config from SQLite.",
    {
      name: z
        .string()
        .describe(
          "Server name to remove (use list_managed_servers to see names)"
        ),
    },
    async (params) => {
      try {
        if (!params.name) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide a 'name' to identify the server to remove.",
              },
            ],
            isError: true,
          };
        }

        // Stop local process
        if (processManager.hasServer(params.name)) {
          await processManager.stopServer(params.name);
        }

        // Remove from SQLite
        const removed = db.removeServer(params.name);
        const dbNote = removed ? " Removed from SQLite." : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully removed server '${params.name}'.${dbNote}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error removing server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 4: list_managed_servers (live state from ProcessManager)
  // ============================================================
  mcpServer.tool(
    "list_managed_servers",
    "List all MCP servers currently configured. Returns server names, types, connection details, status, and whether they are stateful.",
    {},
    async () => {
      try {
        const localServers = processManager.getAllServers();

        // Also check SQLite for servers not yet spawned
        let dbOnlyServers: string[] = [];
        try {
          const dbConfigs = db.listServers();
          const localNames = new Set(localServers.map((s) => s.name));
          dbOnlyServers = dbConfigs
            .filter((s) => !localNames.has(s.name))
            .map((s) => {
              const connection =
                s.type === "STDIO"
                  ? `command: ${s.command} ${(s.args || []).join(" ")}`
                  : `url: ${s.url}`;
              const statefulBadge = s.stateful ? " [stateful]" : "";
              return `- **${s.name}** (${s.type})${statefulBadge} [DB only, not spawned]: ${connection}${s.description ? `\n  ${s.description}` : ""}`;
            });
        } catch {
          // DB unavailable - show local only
        }

        if (localServers.length === 0 && dbOnlyServers.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No MCP servers currently configured.",
              },
            ],
          };
        }

        let output = "";

        if (localServers.length > 0) {
          const summary = localServers
            .map((s) => {
              const connection =
                s.config.type === "STDIO"
                  ? `command: ${s.config.command} ${(s.config.args || []).join(" ")}`
                  : `url: ${s.config.url}`;
              const statusIcon =
                s.status === "connected"
                  ? ""
                  : s.status === "error"
                    ? " [ERROR]"
                    : ` [${s.status.toUpperCase()}]`;
              const pidInfo = s.pid ? ` (PID: ${s.pid})` : "";
              const statefulBadge = s.config.stateful ? " [stateful]" : "";
              return `- **${s.name}** (${s.config.type}${statusIcon})${statefulBadge}${pidInfo}: ${connection}${s.config.description ? `\n  ${s.config.description}` : ""}${s.status === "error" && s.errorMessage ? `\n  Error: ${s.errorMessage.split("\n")[0]}` : ""} - ${s.tools.length} tools`;
            })
            .join("\n");

          output += `## Running Servers (${localServers.length})\n\n${summary}`;
        }

        if (dbOnlyServers.length > 0) {
          output += `\n\n## Saved Servers (not spawned)\n\n${dbOnlyServers.join("\n")}`;
        }

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing servers: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 5: reset_server_error (simple restart)
  // ============================================================
  mcpServer.tool(
    "reset_server_error",
    "Reset a server's ERROR state so it retries connection. Use this when a server was marked as ERROR due to temporary issues (e.g., slow first-time package download) that have since been resolved.",
    {
      name: z.string().describe("Server name to reset"),
    },
    async (params) => {
      try {
        if (!params.name) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide a 'name' to identify the server.",
              },
            ],
            isError: true,
          };
        }

        // Get config from existing server or SQLite DB
        let config: ServerConfig | null = null;
        const existing = processManager.getServer(params.name);
        if (existing) {
          config = { ...existing.config };
        } else {
          // Try to get from SQLite
          config = db.getServer(params.name);
        }

        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server '${params.name}' not found locally or in database.`,
              },
            ],
            isError: true,
          };
        }

        // Restart the server
        const restarted = await processManager.restartServer(params.name);
        if (!restarted) {
          // Server wasn't in processManager, spawn fresh
          const spawned = await processManager.spawnServer(config);
          if (spawned.status === "error") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Server '${params.name}' failed to restart.\n\nError: ${spawned.errorMessage || "Unknown error"}`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Server **${params.name}** restarted successfully (PID: ${spawned.pid}, ${spawned.tools.length} tools).`,
              },
            ],
          };
        }

        if (restarted.status === "error") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server '${params.name}' failed to restart.\n\nError: ${restarted.errorMessage || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Server **${params.name}** restarted successfully (PID: ${restarted.pid}, ${restarted.tools.length} tools).`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error resetting server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 6: list_server_tools (two-step discovery)
  // ============================================================
  mcpServer.tool(
    "list_server_tools",
    `List available tools from managed MCP servers. Shows tool names, descriptions, and parameter schemas.

Use this after adding a server with add_managed_server to discover what tools it provides.
You can filter by server name or list all tools across all servers.`,
    {
      server_name: z
        .string()
        .optional()
        .describe(
          "Filter tools by server name (e.g. 'playwright'). If omitted, lists tools from all servers."
        ),
    },
    async (params) => {
      try {
        const result = processManager.listTools(params.server_name);

        return {
          content: [{ type: "text" as const, text: result.text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing tools: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 7: call_server_tool (direct or queued)
  // ============================================================
  mcpServer.tool(
    "call_server_tool",
    `Call any tool on any managed MCP server. This is how you USE tools from dynamically added servers without needing a Claude Code restart.

The tool name format is: server_name + "__" + tool_name
Example: server_name="time-server", tool_name="get_current_time"

Use list_server_tools first to discover available tools and their parameters.`,
    {
      server_name: z
        .string()
        .describe(
          "Name of the managed server (e.g. 'time-server', 'playwright')"
        ),
      tool_name: z
        .string()
        .describe(
          "Name of the tool to call (e.g. 'get_current_time', 'navigate')"
        ),
      arguments: z
        .record(z.unknown())
        .optional()
        .describe("Arguments to pass to the tool as a JSON object"),
    },
    async (params) => {
      try {
        const args = (params.arguments as Record<string, unknown>) || {};

        // In HTTP mode, use queued calls for concurrency safety
        const result = useQueued
          ? await processManager.callToolQueued(
            params.server_name,
            params.tool_name,
            args,
            sessionId
          )
          : await processManager.callTool(
            params.server_name,
            params.tool_name,
            args
          );

        // Pass through all content types (text, image, audio, etc.)
        const content = result.content.map((c) => {
          if (c.type === "image" && c.data) {
            return {
              type: "image" as const,
              data: c.data,
              mimeType: c.mimeType || "image/png",
            };
          }
          // Default: text content
          return {
            type: "text" as const,
            text: c.text || (c.type !== "text" ? JSON.stringify(c) : ""),
          };
        });

        return {
          content,
          isError: result.isError,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calling tool: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 8: stop_server (stop without removing config)
  // ============================================================
  mcpServer.tool(
    "stop_server",
    "Stop a running MCP server without removing its config from SQLite. The server can be started again later with start_server.",
    {
      name: z
        .string()
        .describe("Server name to stop"),
    },
    async (params) => {
      try {
        if (!processManager.hasServer(params.name)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server '${params.name}' is not currently running.`,
              },
            ],
            isError: true,
          };
        }

        await processManager.stopServer(params.name);

        return {
          content: [
            {
              type: "text" as const,
              text: `Server **${params.name}** stopped. Config preserved in SQLite.\n\nUse \`start_server(name="${params.name}")\` to start it again.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error stopping server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 9: start_server (start a stopped/DB-only server)
  // ============================================================
  mcpServer.tool(
    "start_server",
    "Start a stopped MCP server using its saved config from SQLite. Use this to restart servers that were previously stopped with stop_server.",
    {
      name: z
        .string()
        .describe("Server name to start"),
    },
    async (params) => {
      try {
        // Don't start if already running
        if (processManager.hasServer(params.name)) {
          const existing = processManager.getServer(params.name);
          if (existing?.status === "connected") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Server '${params.name}' is already running.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Load config from SQLite
        const config = db.getServer(params.name);
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server '${params.name}' not found in database. Use \`add_managed_server\` to add it first.`,
              },
            ],
            isError: true,
          };
        }

        const managed = await processManager.spawnServer(config);

        if (managed.status === "error") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server **${params.name}** failed to start.\n\n**Error:** ${managed.errorMessage || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Server **${params.name}** started successfully (PID: ${managed.pid}, ${managed.tools.length} tools).`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error starting server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 10: list_profiles (merges builtin file + custom DB profiles)
  // ============================================================
  mcpServer.tool(
    "list_profiles",
    "List available server profiles (groups). Shows both builtin profiles from profiles.json and custom profiles created via create_profile.",
    {},
    async () => {
      try {
        // Merge builtin (file) + custom (DB) profiles
        const builtinNames = new Set(Object.keys(profilesConfig));
        let dbProfiles: db.DbProfile[] = [];
        try {
          dbProfiles = db.listDbProfiles();
        } catch {
          // DB unavailable
        }

        if (builtinNames.size === 0 && dbProfiles.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No profiles configured. Add profiles to profiles.json or use `create_profile` to create a custom one.",
              },
            ],
          };
        }

        let output = "## Available Profiles\n\n";

        // Builtin profiles
        for (const [name, profile] of Object.entries(profilesConfig)) {
          const activeCount = profile.servers.filter((s) =>
            processManager.hasServer(s.name)
          ).length;
          const status =
            activeCount === profile.servers.length
              ? " [ACTIVE]"
              : activeCount > 0
                ? ` [PARTIAL ${activeCount}/${profile.servers.length}]`
                : "";

          output += `### ${name}${status} [builtin]\n`;
          output += `${profile.description}\n\n`;
          output += `Servers:\n`;

          for (const srv of profile.servers) {
            const isRunning = processManager.hasServer(srv.name);
            const server = processManager.getServer(srv.name);
            const icon = isRunning
              ? server?.status === "connected"
                ? "[running]"
                : `[${server?.status}]`
              : "[stopped]";
            output += `- **${srv.name}** ${icon}: ${srv.description}\n`;
            output += `  \`${srv.command} ${srv.args.join(" ")}\`\n`;
          }
          output += "\n";
        }

        // Custom DB profiles
        for (const dbProfile of dbProfiles) {
          // Skip if overridden by builtin
          if (builtinNames.has(dbProfile.name)) continue;

          const activeCount = dbProfile.servers.filter((s) =>
            processManager.hasServer(s.name)
          ).length;
          const status =
            activeCount === dbProfile.servers.length
              ? " [ACTIVE]"
              : activeCount > 0
                ? ` [PARTIAL ${activeCount}/${dbProfile.servers.length}]`
                : "";

          output += `### ${dbProfile.name}${status} [custom]\n`;
          output += `${dbProfile.description}\n\n`;
          output += `Servers:\n`;

          for (const srv of dbProfile.servers) {
            const isRunning = processManager.hasServer(srv.name);
            const server = processManager.getServer(srv.name);
            const icon = isRunning
              ? server?.status === "connected"
                ? "[running]"
                : `[${server?.status}]`
              : "[stopped]";
            output += `- **${srv.name}** ${icon}: ${srv.description || srv.name}\n`;
            output += `  \`${srv.command} ${(srv.args || []).join(" ")}\`\n`;
          }
          output += "\n";
        }

        output += `---\nUse \`activate_profile\` to start all servers in a profile, or \`deactivate_profile\` to stop them.`;

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing profiles: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 11: activate_profile (spawn locally, persist to SQLite)
  // ============================================================
  mcpServer.tool(
    "activate_profile",
    "Activate a server profile. This starts all servers in the profile and persists their configs to SQLite. Servers already running are skipped. Works with both builtin and custom profiles.",
    {
      profile_name: z
        .string()
        .describe(
          "Name of the profile to activate (use list_profiles to see options)"
        ),
    },
    async (params) => {
      try {
        // Check builtin profiles first, then DB
        const builtinProfile = profilesConfig[params.profile_name];
        let profileServers: Array<{ name: string; command: string; args: string[]; description: string; env?: Record<string, string> }>;

        if (builtinProfile) {
          profileServers = builtinProfile.servers;
        } else {
          const dbProfile = db.getProfile(params.profile_name);
          if (!dbProfile) {
            const builtinNames = Object.keys(profilesConfig);
            let dbNames: string[] = [];
            try { dbNames = db.listDbProfiles().map((p) => p.name); } catch { /* */ }
            const available = [...builtinNames, ...dbNames].join(", ");
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Profile '${params.profile_name}' not found. Available profiles: ${available || "none"}`,
                },
              ],
              isError: true,
            };
          }
          profileServers = dbProfile.servers;
        }

        const results: string[] = [];
        let addedCount = 0;
        let skippedCount = 0;

        for (const srv of profileServers) {
          if (processManager.hasServer(srv.name)) {
            const existing = processManager.getServer(srv.name);
            if (existing?.status === "connected") {
              results.push(`- **${srv.name}**: Already running, skipped`);
              skippedCount++;
              continue;
            }
            if (existing?.status === "connecting") {
              results.push(`- **${srv.name}**: Currently connecting, skipped`);
              skippedCount++;
              continue;
            }
            // If exists but in error/other state, restart
            await processManager.stopServer(srv.name);
          }

          try {
            const config: ServerConfig = {
              name: srv.name,
              type: "STDIO",
              command: srv.command,
              args: srv.args,
              description: srv.description,
              env: srv.env || {},
              stateful: KNOWN_STATEFUL_SERVERS.has(srv.name),
            };

            const managed = await processManager.spawnServer(config);

            if (managed.status === "connected") {
              results.push(
                `- **${srv.name}**: Started (PID: ${managed.pid}, ${managed.tools.length} tools)`
              );
              addedCount++;

              // Persist to SQLite
              try {
                db.upsertServer(config);
              } catch {
                // Non-critical
              }
            } else {
              results.push(
                `- **${srv.name}**: Failed - ${managed.errorMessage || "Unknown error"}`
              );
            }
          } catch (err) {
            results.push(
              `- **${srv.name}**: Error - ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## Profile '${params.profile_name}' Activation\n\nStarted: ${addedCount} | Skipped: ${skippedCount} | Total: ${profileServers.length}\n\n${results.join("\n")}\n\nUse \`list_server_tools\` to see all available tools, then \`call_server_tool\` to use them.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error activating profile: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 12: deactivate_profile (stop locally)
  // ============================================================
  mcpServer.tool(
    "deactivate_profile",
    "Deactivate a profile by stopping all its servers. Works with both builtin and custom profiles.",
    {
      profile_name: z
        .string()
        .describe("Name of the profile to deactivate"),
    },
    async (params) => {
      try {
        // Check builtin profiles first, then DB
        const builtinProfile = profilesConfig[params.profile_name];
        let serverNames: string[];

        if (builtinProfile) {
          serverNames = builtinProfile.servers.map((s) => s.name);
        } else {
          const dbProfile = db.getProfile(params.profile_name);
          if (!dbProfile) {
            const builtinNames = Object.keys(profilesConfig);
            let dbNames: string[] = [];
            try { dbNames = db.listDbProfiles().map((p) => p.name); } catch { /* */ }
            const available = [...builtinNames, ...dbNames].join(", ");
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Profile '${params.profile_name}' not found. Available profiles: ${available || "none"}`,
                },
              ],
              isError: true,
            };
          }
          serverNames = dbProfile.servers.map((s) => s.name);
        }

        const profileServerNames = new Set(serverNames);

        const results: string[] = [];
        let removedCount = 0;

        for (const name of profileServerNames) {
          // Stop local process
          if (processManager.hasServer(name)) {
            await processManager.stopServer(name);
            results.push(`- **${name}**: Stopped`);
            removedCount++;
          }
        }

        if (removedCount === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No servers from profile '${params.profile_name}' were running.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## Profile '${params.profile_name}' Deactivated\n\nStopped ${removedCount} server(s):\n\n${results.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deactivating profile: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 13: update_server (edit config + restart)
  // ============================================================
  mcpServer.tool(
    "update_server",
    "Update an existing server's configuration in SQLite and restart it with the new settings. Only provided fields are updated; omitted fields keep their current values.",
    {
      name: z
        .string()
        .describe("Name of the server to update"),
      command: z
        .string()
        .optional()
        .describe("New command (STDIO only)"),
      args: z
        .array(z.string())
        .optional()
        .describe("New command arguments"),
      env: z
        .record(z.string())
        .optional()
        .describe("New environment variables (replaces all env vars)"),
      url: z
        .string()
        .optional()
        .describe("New URL (SSE/STREAMABLE_HTTP only)"),
      description: z
        .string()
        .optional()
        .describe("New description"),
      headers: z
        .record(z.string())
        .optional()
        .describe("New HTTP headers (SSE/STREAMABLE_HTTP only)"),
      stateful: z
        .boolean()
        .optional()
        .describe("Update stateful flag"),
    },
    async (params) => {
      try {
        // Get existing config from DB or live server
        let config: ServerConfig | null = null;
        const existing = processManager.getServer(params.name);
        if (existing) {
          config = { ...existing.config };
        } else {
          config = db.getServer(params.name);
        }

        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server '${params.name}' not found. Use \`add_managed_server\` to add it first.`,
              },
            ],
            isError: true,
          };
        }

        // Merge provided fields
        if (params.command !== undefined) config.command = params.command;
        if (params.args !== undefined) config.args = params.args;
        if (params.env !== undefined) config.env = params.env;
        if (params.url !== undefined) config.url = params.url;
        if (params.description !== undefined) config.description = params.description;
        if (params.headers !== undefined) config.headers = params.headers;
        if (params.stateful !== undefined) config.stateful = params.stateful;

        // Persist updated config
        db.upsertServer(config);

        // Restart if currently running
        if (processManager.hasServer(params.name)) {
          await processManager.stopServer(params.name);
          const managed = await processManager.spawnServer(config);

          if (managed.status === "error") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Server **${params.name}** config updated but failed to restart.\n\n**Error:** ${managed.errorMessage || "Unknown error"}\n\nConfig saved to SQLite. Use \`start_server\` to try again.`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Server **${params.name}** updated and restarted (PID: ${managed.pid}, ${managed.tools.length} tools).`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Server **${params.name}** config updated in SQLite. Server is not currently running.\n\nUse \`start_server(name="${params.name}")\` to start it with the new config.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating server: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 14: create_profile (save custom profile to SQLite)
  // (was Tool 13 before update_server was added)
  // ============================================================
  mcpServer.tool(
    "create_profile",
    "Create a custom server profile and save it to SQLite. The profile can then be activated/deactivated like builtin profiles.",
    {
      name: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .describe("Profile name (alphanumeric, hyphens, underscores only)"),
      description: z
        .string()
        .describe("Human-readable description of the profile"),
      servers: z
        .array(
          z.object({
            name: z.string().describe("Server name"),
            command: z.string().describe("Command to run (e.g. 'npx', 'uvx')"),
            args: z.array(z.string()).describe("Command arguments"),
            description: z.string().optional().describe("Server description"),
          })
        )
        .describe("Servers in the profile"),
    },
    async (params) => {
      try {
        if (params.servers.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Profile must have at least one server.",
              },
            ],
            isError: true,
          };
        }

        db.upsertProfile(params.name, {
          description: params.description,
          servers: params.servers.map((s) => ({
            name: s.name,
            command: s.command,
            args: s.args,
            description: s.description || s.name,
          })),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Custom profile **${params.name}** created with ${params.servers.length} server(s).\n\nUse \`activate_profile(profile_name="${params.name}")\` to start all its servers.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating profile: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 15: delete_profile (remove custom profile from SQLite)
  // ============================================================
  mcpServer.tool(
    "delete_profile",
    "Delete a custom profile from SQLite. Builtin profiles (from profiles.json) cannot be deleted.",
    {
      name: z
        .string()
        .describe("Profile name to delete"),
    },
    async (params) => {
      try {
        // Prevent deleting builtin profiles
        if (profilesConfig[params.name]) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot delete builtin profile '${params.name}'. Only custom profiles can be deleted.`,
              },
            ],
            isError: true,
          };
        }

        const removed = db.removeProfile(params.name);
        if (!removed) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Profile '${params.name}' not found in database.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Custom profile **${params.name}** deleted.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting profile: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

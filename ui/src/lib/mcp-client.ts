/**
 * MCP Protocol client for communicating with the swarm HTTP server.
 *
 * Uses the Streamable HTTP transport: POST /mcp with JSON-RPC 2.0.
 * The server assigns a session ID via the mcp-session-id response header.
 */

import type {
  ServerInfo,
  ToolInfo,
  ProfileInfo,
  RegistryResult,
  HealthInfo,
  AddServerParams,
  CreateProfileParams,
} from "./types";
import {
  extractText,
  parseServersResponse,
  parseToolsResponse,
  parseProfilesResponse,
  parseRegistryResponse,
} from "./utils/parse-mcp-response";

let nextId = 1;

export class McpClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl: string = "http://localhost:3100") {
    this.baseUrl = baseUrl;
  }

  /** Send a JSON-RPC 2.0 request to /mcp */
  private async rpc(
    method: string,
    params?: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text?: string }> }> {
    const id = nextId++;
    const body = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Capture session ID from response
    const sid = res.headers.get("mcp-session-id");
    if (sid) {
      this.sessionId = sid;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MCP error ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";

    // Server may respond with SSE stream instead of plain JSON
    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      // Parse SSE: find lines starting with "data: " and extract JSON-RPC response
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.slice(6));
            if (json.id === id) {
              if (json.error) {
                throw new Error(json.error.message || JSON.stringify(json.error));
              }
              return json.result ?? { content: [] };
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith("MCP")) throw e;
            // Skip non-JSON lines
          }
        }
      }
      return { content: [] };
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }

    return json.result ?? { content: [] };
  }

  /** Initialize an MCP session */
  async connect(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "swarm-dashboard", version: "1.0.0" },
    });
    // Send initialized notification
    await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  }

  /** Close the session */
  async disconnect(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`${this.baseUrl}/mcp`, {
        method: "DELETE",
        headers: { "mcp-session-id": this.sessionId },
      });
    } finally {
      this.sessionId = null;
    }
  }

  /** Call an MCP tool by name */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    return this.rpc("tools/call", { name, arguments: args }) as Promise<{
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }>;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  // --- Convenience methods wrapping tool calls ---

  async listManagedServers(): Promise<ServerInfo[]> {
    const result = await this.callTool("list_managed_servers");
    const text = extractText(result);
    if (!text || text.includes("No MCP servers")) return [];
    return parseServersResponse(text);
  }

  async addManagedServer(config: AddServerParams): Promise<string> {
    const result = await this.callTool("add_managed_server", config as unknown as Record<string, unknown>);
    return extractText(result);
  }

  async removeManagedServer(name: string): Promise<string> {
    const result = await this.callTool("remove_managed_server", { name });
    return extractText(result);
  }

  async restartServer(name: string): Promise<string> {
    const result = await this.callTool("reset_server_error", { name });
    return extractText(result);
  }

  async stopServer(name: string): Promise<string> {
    const result = await this.callTool("stop_server", { name });
    return extractText(result);
  }

  async startServer(name: string): Promise<string> {
    const result = await this.callTool("start_server", { name });
    return extractText(result);
  }

  async updateServer(params: Record<string, unknown>): Promise<string> {
    const result = await this.callTool("update_server", params);
    return extractText(result);
  }

  async listServerTools(serverName?: string): Promise<ToolInfo[]> {
    const args: Record<string, unknown> = {};
    if (serverName) args.server_name = serverName;
    const result = await this.callTool("list_server_tools", args);
    const text = extractText(result);
    return parseToolsResponse(text);
  }

  async callServerTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    return this.callTool("call_server_tool", {
      server_name: serverName,
      tool_name: toolName,
      arguments: args ?? {},
    });
  }

  async listProfiles(): Promise<ProfileInfo[]> {
    const result = await this.callTool("list_profiles");
    const text = extractText(result);
    if (!text || text.includes("No profiles")) return [];
    return parseProfilesResponse(text);
  }

  async activateProfile(name: string): Promise<string> {
    const result = await this.callTool("activate_profile", {
      profile_name: name,
    });
    return extractText(result);
  }

  async deactivateProfile(name: string): Promise<string> {
    const result = await this.callTool("deactivate_profile", {
      profile_name: name,
    });
    return extractText(result);
  }

  async createProfile(params: CreateProfileParams): Promise<string> {
    const result = await this.callTool("create_profile", params as unknown as Record<string, unknown>);
    return extractText(result);
  }

  async deleteProfile(name: string): Promise<string> {
    const result = await this.callTool("delete_profile", { name });
    return extractText(result);
  }

  async searchRegistry(query: string): Promise<RegistryResult[]> {
    const result = await this.callTool("search_mcp_registry", { query });
    const text = extractText(result);
    return parseRegistryResponse(text);
  }

  async getHealth(): Promise<HealthInfo> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return res.json();
  }
}

export const mcpClient = new McpClient();

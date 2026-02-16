/**
 * REST API client for the swarm HTTP server's non-MCP endpoints.
 *
 * Endpoints:
 *   GET /health        - Health check
 *   GET /api/sessions  - List active sessions
 *   GET /api/logs/:name - Get server stderr logs
 *   GET /api/config    - Get swarm config
 */

import type { SessionInfo, SwarmConfig, HealthInfo } from "./types";

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:3100") {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async getHealth(): Promise<HealthInfo> {
    return this.request<HealthInfo>("/health");
  }

  async getSessions(): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>("/api/sessions");
  }

  async getLogs(serverName: string): Promise<string[]> {
    return this.request<string[]>(
      `/api/logs/${encodeURIComponent(serverName)}`
    );
  }

  async getConfig(): Promise<SwarmConfig> {
    return this.request<SwarmConfig>("/api/config");
  }
}

export const apiClient = new ApiClient();

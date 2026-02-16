/**
 * SQLite persistence layer for MCP Swarm.
 *
 * Replaces JSON file config (servers.json, pids.json) with a single
 * local SQLite database.
 * Uses WAL mode for safe concurrent reads.
 */

import Database from "better-sqlite3";
import { BRIDGE_DB_PATH } from "./config.js";
import type { ServerConfig } from "./types.js";
import { KNOWN_STATEFUL_SERVERS } from "./config.js";

let db: Database.Database | null = null;

/**
 * Initialize the SQLite database. Creates tables if they don't exist.
 * Must be called once at startup before any other db functions.
 */
export function initDb(): void {
  db = new Database(BRIDGE_DB_PATH);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      name        TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      command     TEXT,
      args        TEXT DEFAULT '[]',
      env         TEXT DEFAULT '{}',
      url         TEXT,
      description TEXT,
      headers     TEXT DEFAULT '{}',
      stateful    INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pids (
      name TEXT PRIMARY KEY,
      pid  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      servers     TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

// --- Server CRUD ---

/**
 * Insert or update a server config. Stateful flag is auto-detected
 * from KNOWN_STATEFUL_SERVERS if not explicitly set in the config.
 */
export function upsertServer(config: ServerConfig): void {
  const d = getDb();
  const stateful = (config.stateful ?? KNOWN_STATEFUL_SERVERS.has(config.name)) ? 1 : 0;

  d.prepare(`
    INSERT INTO servers (name, type, command, args, env, url, description, headers, stateful)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = excluded.type,
      command = excluded.command,
      args = excluded.args,
      env = excluded.env,
      url = excluded.url,
      description = excluded.description,
      headers = excluded.headers,
      stateful = excluded.stateful
  `).run(
    config.name,
    config.type,
    config.command || null,
    JSON.stringify(config.args || []),
    JSON.stringify(config.env || {}),
    config.url || null,
    config.description || null,
    JSON.stringify(config.headers || {}),
    stateful
  );
}

/**
 * Remove a server from the database by name.
 */
export function removeServer(name: string): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM servers WHERE name = ?").run(name);
  return result.changes > 0;
}

/**
 * Load all server configs from the database.
 */
export function listServers(): ServerConfig[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM servers").all() as Array<{
    name: string;
    type: string;
    command: string | null;
    args: string;
    env: string;
    url: string | null;
    description: string | null;
    headers: string;
    stateful: number;
  }>;

  return rows.map((row) => ({
    name: row.name,
    type: row.type as ServerConfig["type"],
    command: row.command || undefined,
    args: JSON.parse(row.args) as string[],
    env: JSON.parse(row.env) as Record<string, string>,
    url: row.url || undefined,
    description: row.description || undefined,
    headers: (() => {
      const h = JSON.parse(row.headers) as Record<string, string>;
      return Object.keys(h).length > 0 ? h : undefined;
    })(),
    stateful: row.stateful === 1,
  }));
}

/**
 * Get a single server config by name.
 */
export function getServer(name: string): ServerConfig | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM servers WHERE name = ?").get(name) as {
    name: string;
    type: string;
    command: string | null;
    args: string;
    env: string;
    url: string | null;
    description: string | null;
    headers: string;
    stateful: number;
  } | undefined;

  if (!row) return null;

  return {
    name: row.name,
    type: row.type as ServerConfig["type"],
    command: row.command || undefined,
    args: JSON.parse(row.args) as string[],
    env: JSON.parse(row.env) as Record<string, string>,
    url: row.url || undefined,
    description: row.description || undefined,
    headers: (() => {
      const h = JSON.parse(row.headers) as Record<string, string>;
      return Object.keys(h).length > 0 ? h : undefined;
    })(),
    stateful: row.stateful === 1,
  };
}

// --- Profile CRUD ---

export interface DbProfile {
  name: string;
  description: string;
  servers: Array<{
    name: string;
    command: string;
    args: string[];
    description: string;
    env?: Record<string, string>;
  }>;
}

/**
 * Insert or update a custom profile.
 */
export function upsertProfile(name: string, profile: Omit<DbProfile, "name">): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO profiles (name, description, servers)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      servers = excluded.servers
  `).run(
    name,
    profile.description,
    JSON.stringify(profile.servers)
  );
}

/**
 * Remove a custom profile by name.
 */
export function removeProfile(name: string): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM profiles WHERE name = ?").run(name);
  return result.changes > 0;
}

/**
 * Get a single profile by name.
 */
export function getProfile(name: string): DbProfile | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM profiles WHERE name = ?").get(name) as {
    name: string;
    description: string;
    servers: string;
  } | undefined;

  if (!row) return null;

  return {
    name: row.name,
    description: row.description,
    servers: JSON.parse(row.servers),
  };
}

/**
 * List all custom profiles from the database.
 */
export function listDbProfiles(): DbProfile[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM profiles").all() as Array<{
    name: string;
    description: string;
    servers: string;
  }>;

  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    servers: JSON.parse(row.servers),
  }));
}

// --- PID Tracking ---

/**
 * Save a server's PID to the database.
 */
export function savePid(name: string, pid: number): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO pids (name, pid) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET pid = excluded.pid
  `).run(name, pid);
}

/**
 * Remove a server's PID from tracking.
 */
export function removePid(name: string): void {
  const d = getDb();
  d.prepare("DELETE FROM pids WHERE name = ?").run(name);
}

/**
 * Load all tracked PIDs.
 */
export function loadPids(): Record<string, number> {
  const d = getDb();
  const rows = d.prepare("SELECT name, pid FROM pids").all() as Array<{
    name: string;
    pid: number;
  }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.name] = row.pid;
  }
  return result;
}

/**
 * Clear all tracked PIDs (after cleanup).
 */
export function clearPids(): void {
  const d = getDb();
  d.prepare("DELETE FROM pids").run();
}

/**
 * Close the database connection. Call on shutdown.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

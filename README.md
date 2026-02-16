# MCP Swarm

**Give any AI agent the ability to find, install, and use any MCP server on the fly.**

MCP Swarm is a **local-only** server manager that runs on your machine, sitting between your AI agents and the [MCP ecosystem](https://modelcontextprotocol.io). Instead of manually configuring each MCP server for each agent, you run one swarm and every agent connected to it can dynamically discover, install, and use any of the 2,290+ servers in the MCP registry -- no restarts, no config files, no human intervention.

> **Local use only.** MCP Swarm is designed to run on your local machine (localhost). It binds to `127.0.0.1` by default and is not intended to be exposed to the internet. All servers, data, and configs stay on your machine.

## The Problem

Setting up MCP servers today is painful:

- **Manual configuration** -- Every server needs to be added to each agent's config file, then the agent restarted
- **No discovery** -- Agents can't find new servers on their own. If an agent needs a capability it doesn't have (database access, web scraping, email), a human has to set it up
- **No sharing** -- If you run multiple agents (Claude Code, Agent Zero, OpenClaw), each needs its own copy of every server. Three agents using Playwright = three separate configs
- **No isolation** -- Stateful servers like Playwright hold browser state. Two agents sharing one Playwright instance corrupt each other's sessions
- **Servers crash silently** -- When a server dies, the agent just gets errors. Nobody restarts it

## The Solution

MCP Swarm fixes all of this with one process:

```
Claude Code ──┐
Agent Zero  ──┼── HTTP :3100/mcp ──→ MCP Swarm ──→ Shared Server Pool
OpenClaw    ──┘                          │           ├── playwright (isolated per agent)
                                         │           ├── fetch-server (shared)
                                         │           ├── sqlite (shared)
                                         │           └── ... any MCP server
                                         │
                                    SQLite persistence
                                    Health watchdog
                                    Dashboard UI
```

**Agents become self-sufficient.** When an agent needs a capability, it searches the registry, installs the server, and uses it -- all within a single conversation:

```
Agent: "I need to fetch a webpage"
  1. search_mcp_registry("web fetch")        → finds mcp-server-fetch
  2. add_managed_server("fetch", "uvx", ...)  → server starts instantly
  3. call_server_tool("fetch", "fetch", ...)  → gets the page content
  4. Every other agent can now use "fetch" too
```

No restart. No config file edits. No human in the loop.

## Quick Start

```bash
git clone https://github.com/SpideXD/mcp-swarm.git
cd mcp-swarm

# Copy the example env and adjust if needed
cp .env.example .env

npm install && npm run build

# Single agent (stdio)
npm start

# Multiple agents (HTTP) + dashboard UI
SWARM_PORT=3100 SWARM_CORS=1 npm start
```

### Environment Setup

Both backend and frontend include `.env.example` files. Copy them to get started:

**Backend** (`.env`):
```bash
cp .env.example .env
```
```env
SWARM_PORT=3100          # HTTP port (enables multi-agent mode)
SWARM_HOST=127.0.0.1     # Bind address (keep localhost for security)
SWARM_CORS=1             # Required for dashboard UI to connect
# SWARM_DATA_DIR=~/.mcp-swarm   # SQLite storage location
# HEALTH_CHECK_INTERVAL_MS=60000 # Health ping interval (0 to disable)
```

**Frontend** (`ui/.env.local`):
```bash
cp ui/.env.example ui/.env.local
```
```env
NEXT_PUBLIC_SWARM_URL=http://localhost:3100  # Backend URL
```

The frontend URL is also configurable from the dashboard connection input at runtime.

### Connect Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "swarm": {
      "command": "node",
      "args": ["/path/to/mcp-swarm/dist/index.js"]
    }
  }
}
```

Or if the swarm is already running in HTTP mode:

```json
{
  "mcpServers": {
    "swarm": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

### Connect Any MCP Client

Point any MCP-compatible client at `http://localhost:3100/mcp` using Streamable HTTP transport.

## What The Agent Gets

Once connected, the agent has 15 tools:

| Tool | What it does |
|------|-------------|
| `search_mcp_registry` | Search 2,290+ servers in the official MCP registry |
| `add_managed_server` | Install and start a new server (STDIO, SSE, or HTTP) |
| `remove_managed_server` | Stop and remove a server |
| `list_managed_servers` | See all running servers with status and tool count |
| `stop_server` | Stop a server without removing its config |
| `start_server` | Start a stopped server |
| `reset_server_error` | Restart a crashed server |
| `update_server` | Change a server's config (command, args, env) and restart |
| `list_server_tools` | See what tools a server provides |
| `call_server_tool` | Call any tool on any managed server |
| `list_profiles` | See available server bundles |
| `activate_profile` | Start a whole bundle of servers at once |
| `deactivate_profile` | Stop a bundle |
| `create_profile` | Create a custom server bundle |
| `delete_profile` | Delete a custom bundle |

The key insight: **the agent doesn't need to know about MCP Swarm in advance**. The tool descriptions guide the agent to search the registry before saying "I can't do that". The agent naturally follows: search -> install -> use.

## Key Features

### Shared Server Pool

One agent installs a server, every agent can use it. No duplication.

### Stateful Server Isolation

Servers like Playwright and Puppeteer hold browser state. The swarm automatically detects these and gives each agent session its own isolated instance:

```
Agent A calls playwright → spawns playwright@session-abc (PID 1001)
Agent B calls playwright → spawns playwright@session-def (PID 1002)
Agent A disconnects      → kills playwright@session-abc, Agent B unaffected
```

Auto-detected: `playwright`, `puppeteer`, `sequential-thinking`, `git-mcp`. Or mark any server as stateful explicitly.

### Health Watchdog

The swarm pings every server periodically. If a server stops responding, it gets automatically restarted. No more silent failures.

### Server Profiles

Predefined bundles for common workflows:

| Profile | Servers |
|---------|---------|
| `frontend` | playwright, fetch-server, sequential-thinking |
| `backend` | postgres, sqlite, docker, sequential-thinking |
| `devops` | docker, kubernetes, git |
| `data` | sqlite, postgres, filesystem |
| `web` | fetch-server, playwright, puppeteer |

Create custom profiles via the API or dashboard UI. Activate a profile and all its servers spin up at once.

### Auto Pool Scaling

When a server gets busy, the swarm automatically spawns extra instances to handle the load. Idle instances are cleaned up after 60 seconds. Primary instance always stays running.

### SQLite Persistence

All server configs and custom profiles survive restarts. No external database needed.

### Dashboard UI

A Next.js web interface for visual management:

- Server grid with real-time status
- Add, edit, stop, start, restart, remove servers
- Create and manage profiles
- Browse and execute tools
- Search the MCP registry and install with one click
- Session viewer and activity feed
- Real-time updates via SSE

```bash
cd ui && npm install && npm run build
# Serve the static files from ui/out/
```

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP protocol messages |
| `/mcp` | GET | SSE notifications |
| `/mcp` | DELETE | End session |
| `/health` | GET | Status, server count, uptime |
| `/config` | GET | Server configuration |
| `/sessions` | GET | Active sessions |
| `/events` | GET | SSE event stream (for dashboard) |
| `/api/logs/:name` | GET | Server log output |

## Configuration

All env vars use the `SWARM_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_PORT` | `3100` | HTTP port (setting this enables HTTP mode) |
| `SWARM_HOST` | `127.0.0.1` | Bind address |
| `SWARM_CORS` | `0` | Enable CORS (needed for dashboard UI) |
| `SWARM_DATA_DIR` | `~/.mcp-swarm` | SQLite storage directory |
| `MAX_SERVER_INSTANCES` | `4` | Max pool instances per server |
| `TOOL_CALL_TIMEOUT_MS` | `60000` | Tool call timeout |
| `HEALTH_CHECK_INTERVAL_MS` | `60000` | Health ping interval (0 to disable) |

## Project Structure

```
src/
  index.ts              Entry point (stdio/HTTP mode selection)
  config.ts             Environment variables
  types.ts              TypeScript interfaces
  db.ts                 SQLite (servers, PIDs, profiles)
  tools.ts              15 MCP tool definitions
  process-manager.ts    Server lifecycle, scaling, isolation, health watchdog
  request-queue.ts      FIFO queue with concurrency control
  http-server.ts        HTTP server, REST APIs, SSE
  search.ts             MCP registry search
ui/
  src/app/              Next.js pages
  src/components/       React components
  src/lib/              MCP client, stores, types
profiles.json           Builtin profile definitions
test-e2e.mjs            E2E test suite
```

## Testing

```bash
SWARM_PORT=3100 SWARM_CORS=1 npm start &
node test-e2e.mjs
```

65 tests across 13 suites covering all 15 tools, REST APIs, session isolation, concurrent access, profile CRUD, and edge cases.

## License

MIT

/**
 * RequestQueue - Per-server FIFO queue with concurrency control.
 *
 * Prevents concurrent tool calls to single-threaded MCP servers.
 * Each server gets its own queue. When a server has multiple instances
 * (via pool scaling), the queue dispatches to idle instances first.
 *
 * Callers simply `await enqueue(...)` — the queue handles scheduling.
 */

import type { ToolCallResult, ServerInstance } from "./types.js";
import { SCALE_UP_WAIT_MS, QUEUE_REQUEST_TTL_MS } from "./config.js";

// Re-export ServerInstance for convenience
export type { ServerInstance } from "./types.js";

export interface QueuedRequest {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (result: ToolCallResult) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

export type ExecutorFn = (
  instanceName: string,
  toolName: string,
  args: Record<string, unknown>
) => Promise<ToolCallResult>;

export type ScaleUpFn = (serverName: string) => void;

export class RequestQueue {
  /** Per-server queue of waiting requests */
  private queues = new Map<string, QueuedRequest[]>();

  /** Per-server list of instances (primary + scaled) */
  private instances = new Map<string, ServerInstance[]>();

  /** Function to actually execute a tool call on a specific instance */
  private executor: ExecutorFn;

  /** Callback when the queue thinks a new instance should be spawned */
  private onScaleUp: ScaleUpFn;

  /** Timer for checking scale-up needs */
  private scaleCheckTimer: ReturnType<typeof setInterval> | null = null;

  /** Track servers with pending scale-up to avoid repeat signals */
  private pendingScaleUps = new Set<string>();

  constructor(executor: ExecutorFn, onScaleUp: ScaleUpFn) {
    this.executor = executor;
    this.onScaleUp = onScaleUp;

    // Check for scale-up needs and expire stale requests every second
    this.scaleCheckTimer = setInterval(() => {
      this._expireStaleRequests();
      this._checkScaleUp();
    }, 1000);
    this.scaleCheckTimer.unref();
  }

  /**
   * Register a server instance with the queue.
   * Called when a server is spawned (primary or scaled copy).
   */
  registerInstance(instance: ServerInstance): void {
    let list = this.instances.get(instance.baseName);
    if (!list) {
      list = [];
      this.instances.set(instance.baseName, list);
    }
    // Avoid duplicates
    const existing = list.findIndex(
      (i) => i.internalName === instance.internalName
    );
    if (existing >= 0) {
      list[existing] = instance;
    } else {
      list.push(instance);
    }
  }

  /**
   * Unregister a server instance (e.g., when killed for being idle).
   */
  unregisterInstance(internalName: string, baseName: string): void {
    const list = this.instances.get(baseName);
    if (!list) return;
    const idx = list.findIndex((i) => i.internalName === internalName);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      this.instances.delete(baseName);
    }
  }

  /**
   * Get all instances for a server.
   * Returns a shallow copy to prevent iterator invalidation.
   */
  getInstances(baseName: string): ServerInstance[] {
    return [...(this.instances.get(baseName) || [])];
  }

  /**
   * Enqueue a tool call. Returns a promise that resolves when the call completes.
   */
  enqueue(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    return new Promise<ToolCallResult>((resolve, reject) => {
      let queue = this.queues.get(serverName);
      if (!queue) {
        queue = [];
        this.queues.set(serverName, queue);
      }

      queue.push({
        serverName,
        toolName,
        args,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });

      // Try to dispatch immediately
      this._dispatch(serverName);
    });
  }

  /**
   * Get queue depth for a server.
   */
  getQueueDepth(serverName: string): number {
    return this.queues.get(serverName)?.length ?? 0;
  }

  /**
   * Stop the queue (cleanup timers).
   */
  stop(): void {
    if (this.scaleCheckTimer) {
      clearInterval(this.scaleCheckTimer);
      this.scaleCheckTimer = null;
    }
  }

  /**
   * Trigger dispatch from outside (e.g., after scale-up registers a new instance).
   */
  triggerDispatch(serverName: string): void {
    this._dispatch(serverName);
  }

  /**
   * Try to dispatch queued requests to idle instances.
   * Loops to saturate ALL idle instances, not just one.
   */
  private _dispatch(serverName: string): void {
    const queue = this.queues.get(serverName);
    if (!queue || queue.length === 0) return;

    let instances = this.instances.get(serverName);
    if (!instances || instances.length === 0) {
      // Auto-register a primary instance so we get busy-tracking
      const fallbackInstance: ServerInstance = {
        internalName: serverName,
        baseName: serverName,
        index: 0,
        busy: false,
        lastActiveAt: Date.now(),
      };
      this.registerInstance(fallbackInstance);
      instances = this.instances.get(serverName)!;
    }

    // Loop: dispatch to ALL idle instances until queue is drained
    for (const instance of instances) {
      if (queue.length === 0) break;
      if (instance.busy) continue;

      const request = queue.shift()!;
      this._execute(request, instance.internalName, instance);
    }
  }

  /**
   * Execute a request on a specific instance.
   */
  private async _execute(
    request: QueuedRequest,
    instanceName: string,
    instance?: ServerInstance
  ): Promise<void> {
    if (instance) {
      instance.busy = true;
    }

    try {
      const result = await this.executor(
        instanceName,
        request.toolName,
        request.args
      );
      request.resolve(result);
    } catch (err) {
      request.reject(
        err instanceof Error ? err : new Error(String(err))
      );
    } finally {
      if (instance) {
        instance.busy = false;
        instance.lastActiveAt = Date.now();
      }
      // After completion, try to dispatch next queued request
      this._dispatch(request.serverName);
    }
  }

  /**
   * Bulk-reject all queued requests and unregister all instances for a server.
   * Called when a server is stopped or removed to avoid one-by-one failure cascade.
   */
  drainServer(serverName: string, reason: string): number {
    let drained = 0;

    // Reject all queued (not yet dispatched) requests
    const queue = this.queues.get(serverName);
    if (queue) {
      while (queue.length > 0) {
        const request = queue.shift()!;
        request.reject(new Error(reason));
        drained++;
      }
      this.queues.delete(serverName);
    }

    // Unregister all instances (primary + scaled)
    this.instances.delete(serverName);

    // Clear pending scale-up
    this.pendingScaleUps.delete(serverName);

    return drained;
  }

  /**
   * Clear the pending scale-up flag for a server.
   * Called by ProcessManager after a scale-up completes (success or failure).
   */
  clearPendingScaleUp(serverName: string): void {
    this.pendingScaleUps.delete(serverName);
  }

  /**
   * Expire queued requests that have waited longer than QUEUE_REQUEST_TTL_MS.
   * Prevents callers from hanging forever when a server is down.
   */
  private _expireStaleRequests(): void {
    const now = Date.now();

    for (const [serverName, queue] of this.queues) {
      let expired = 0;
      while (queue.length > 0 && now - queue[0].enqueuedAt > QUEUE_REQUEST_TTL_MS) {
        const request = queue.shift()!;
        request.reject(
          new Error(
            `Request for ${request.toolName} on ${serverName} timed out after ${QUEUE_REQUEST_TTL_MS}ms in queue`
          )
        );
        expired++;
      }
      if (expired > 0) {
        console.error(
          `[RequestQueue] Expired ${expired} stale request(s) for ${serverName}`
        );
      }
      if (queue.length === 0) {
        this.queues.delete(serverName);
      }
    }
  }

  /**
   * Check if any server needs scaling up.
   * Triggered periodically by the timer.
   */
  private _checkScaleUp(): void {
    const now = Date.now();

    for (const [serverName, queue] of this.queues) {
      if (queue.length === 0) continue;

      // Don't signal if already pending
      if (this.pendingScaleUps.has(serverName)) continue;

      // Check if the oldest request has been waiting too long
      const oldest = queue[0];
      if (now - oldest.enqueuedAt < SCALE_UP_WAIT_MS) continue;

      // Check if all instances are busy
      const instances = this.instances.get(serverName);
      if (!instances || instances.length === 0) continue;

      const allBusy = instances.every((i) => i.busy);
      if (!allBusy) continue;

      // Signal that this server needs a new instance
      this.pendingScaleUps.add(serverName);
      this.onScaleUp(serverName);
    }
  }
}

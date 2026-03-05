/**
 * Web Worker interface for offloading force simulation to a background thread.
 * The main thread handles rendering only; simulation runs in the worker.
 *
 * Protocol:
 *   Main → Worker: { type: "init", nodes, links } | { type: "tick" } | { type: "stop" }
 *   Worker → Main: { type: "positions", positions: Float32Array } (transferable)
 */

export interface WorkerInitMessage {
  type: "init";
  nodes: Array<{ id: string; x: number; y: number; z: number; vertical: string }>;
  links: Array<{ source: string; target: string }>;
}

export interface WorkerTickMessage {
  type: "tick";
}

export interface WorkerStopMessage {
  type: "stop";
}

export interface WorkerPositionsMessage {
  type: "positions";
  positions: Float32Array;
}

export type WorkerInMessage = WorkerInitMessage | WorkerTickMessage | WorkerStopMessage;
export type WorkerOutMessage = WorkerPositionsMessage;

/**
 * Create and manage a force simulation Web Worker.
 * Falls back to main-thread simulation if workers aren't available.
 */
export class SimulationWorker {
  private worker: Worker | null = null;
  private onPositions: ((positions: Float32Array) => void) | null = null;

  constructor(private workerUrl: string | URL) {}

  start(
    nodes: WorkerInitMessage["nodes"],
    links: WorkerInitMessage["links"],
    onPositions: (positions: Float32Array) => void,
  ): void {
    this.onPositions = onPositions;

    try {
      this.worker = new Worker(this.workerUrl, { type: "module" });
      this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        if (e.data.type === "positions") {
          this.onPositions?.(e.data.positions);
        }
      };
      this.worker.onerror = (e) => {
        console.error("Simulation worker error:", e);
      };

      const msg: WorkerInitMessage = { type: "init", nodes, links };
      this.worker.postMessage(msg);
    } catch {
      console.warn("Web Worker not available, simulation runs on main thread");
    }
  }

  requestTick(): void {
    this.worker?.postMessage({ type: "tick" } satisfies WorkerTickMessage);
  }

  stop(): void {
    this.worker?.postMessage({ type: "stop" } satisfies WorkerStopMessage);
    this.worker?.terminate();
    this.worker = null;
    this.onPositions = null;
  }
}

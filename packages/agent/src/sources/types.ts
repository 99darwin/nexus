import type { RawItem } from "@nexus/shared";

export type { RawItem };

export interface SourceAdapter {
  name: string;
  priority: "P0" | "P1" | "P2";
  /**
   * Fetch the current window of items.
   *
   * Implementations MUST observe `signal`: the poll loop serializes cycles, so
   * a `poll` that keeps running past an abort holds up every other adapter.
   * Forward it to `fetch` and to any sleep; the base adapter does both.
   */
  poll(signal?: AbortSignal): Promise<RawItem[]>;
}

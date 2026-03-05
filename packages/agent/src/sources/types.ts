export interface RawItem {
  source: string;
  source_url: string;
  title: string;
  content: string;
  published_at: string;
  raw_metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  priority: "P0" | "P1" | "P2";
  poll(): Promise<RawItem[]>;
}

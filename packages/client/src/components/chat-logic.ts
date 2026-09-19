/* chat transcript engine — ported from nickysapdotdev/src/sections/chat.ts.
 * framework-free on purpose: ChatBox.tsx is a thin react shell over this, and
 * the reveal/reentrancy behaviour is unit-tested without a dom. */

import type { ChatResult, FeedItem } from "../data/feed-types";
import { isSafeHttpUrl, relativeTime, truncateUrl } from "../data/time";
import { verticalLabel } from "../theme/vertical-colors";

export const PLACEHOLDER_PROMPTS: readonly string[] = [
  "funding rounds this week",
  "new model releases",
  "what shipped in agents?",
  "acquisitions this month",
];

export const PLACEHOLDER_INTERVAL_MS = 4000;
export const LINE_DELAY_MS = 120;
export const MAX_LOG_LINES = 200;

export const GREETING: readonly string[] = [
  "ask about indexed ai news — launches, funding, papers, releases.",
  "answers come from the feed index only. nothing is generated.",
];

export const REFUSAL_FALLBACK =
  "i only search indexed ai news — try 'funding rounds this week' or 'new model releases'";

export type ChatLineKind = "user" | "dim" | "title" | "meta" | "link";

export interface ChatLine {
  id: number;
  kind: ChatLineKind;
  text: string;
  href?: string;
}

export type DraftLine = Omit<ChatLine, "id">;

export interface ChatSnapshot {
  lines: ChatLine[];
  thinking: boolean;
  awaiting: boolean;
}

/** Keeps the transcript bounded — the dom node count is the real cost here. */
export function pruneLines(lines: ChatLine[], max = MAX_LOG_LINES): ChatLine[] {
  return lines.length <= max ? lines : lines.slice(lines.length - max);
}

function facetTail(interpreted: {
  vertical: string | null;
  event_type: string | null;
  timeframe: string | null;
}): string {
  const parts = [
    interpreted.vertical ? verticalLabel(interpreted.vertical) : null,
    interpreted.event_type,
    interpreted.timeframe ? interpreted.timeframe.replace(/_/g, " ") : null,
  ].filter((part): part is string => Boolean(part) && part !== "any" && part !== "all time");
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

/** One item renders as a three-line terminal block: title, dim meta, link. */
export function linesForItem(item: FeedItem): DraftLine[] {
  const meta = [item.source, relativeTime(item.published_at), verticalLabel(item.vertical)]
    .filter(Boolean)
    .join(" · ");

  const lines: DraftLine[] = [
    { kind: "title", text: item.title },
    { kind: "meta", text: meta },
  ];

  if (isSafeHttpUrl(item.url)) {
    lines.push({ kind: "link", text: truncateUrl(item.url), href: item.url });
  }
  return lines;
}

export function rateLimitText(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `rate limited — try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Normalized api outcome -> the lines the transcript should reveal. */
export function linesForResult(result: ChatResult): DraftLine[] {
  switch (result.kind) {
    case "refusal":
      return [{ kind: "dim", text: result.refusal || REFUSAL_FALLBACK }];

    case "rate_limited":
      return [{ kind: "dim", text: rateLimitText(result.retryAfterMs) }];

    case "error":
      return [{ kind: "dim", text: "search unavailable — try again shortly." }];

    case "items": {
      if (result.items.length === 0) {
        return [{ kind: "dim", text: "no matches in the index." }];
      }
      const count = result.items.length;
      const header: DraftLine = {
        kind: "dim",
        text: `${count} item${count === 1 ? "" : "s"}${facetTail(result.interpreted)}`,
      };
      return [header, ...result.items.flatMap(linesForItem)];
    }
  }
}

export interface ChatSessionOptions {
  post: (message: string) => Promise<ChatResult>;
  onChange: (snapshot: ChatSnapshot) => void;
  /** reduced motion (or tests) append the whole block synchronously */
  reducedMotion?: boolean;
  lineDelayMs?: number;
  greeting?: readonly string[];
}

/**
 * Owns the transcript. At most one response animates at a time: a new submit
 * cancels the in-flight response's timers and flushes its remaining lines
 * synchronously, so blocks never interleave.
 */
export class ChatSession {
  private lines: ChatLine[] = [];
  private seq = 0;
  private thinking = false;
  private awaiting = false;
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private pendingFlush: (() => void) | null = null;

  constructor(private readonly options: ChatSessionOptions) {
    const greeting = options.greeting ?? GREETING;
    this.lines = greeting.map((text) => ({ id: this.seq++, kind: "dim" as const, text }));
  }

  getSnapshot(): ChatSnapshot {
    return { lines: this.lines, thinking: this.thinking, awaiting: this.awaiting };
  }

  get isAwaiting(): boolean {
    return this.awaiting;
  }

  /** @returns false when the submit was rejected (empty, or a reply is in flight). */
  submit(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || this.awaiting) return false;

    this.flushPending();
    this.append([{ kind: "user", text: `> ${trimmed}` }]);
    void this.run(trimmed);
    return true;
  }

  /** Clears pending reveal timers. The session stays usable afterwards. */
  dispose(): void {
    this.pendingTimers.forEach(clearTimeout);
    this.pendingTimers = [];
    this.pendingFlush = null;
  }

  private async run(message: string): Promise<void> {
    this.awaiting = true;
    this.thinking = true;
    this.emit();

    let result: ChatResult;
    try {
      result = await this.options.post(message);
    } catch {
      result = { kind: "error" };
    }

    this.thinking = false;
    // released before the staggered reveal — mirrors the reference impl, where
    // the guard covers the network round-trip, not the animation
    this.awaiting = false;
    this.reveal(linesForResult(result));
  }

  private reveal(drafts: DraftLine[]): void {
    const delay = this.options.lineDelayMs ?? LINE_DELAY_MS;
    if (this.options.reducedMotion || delay <= 0) {
      this.append(drafts);
      return;
    }

    let nextSlot = 0;
    this.pendingTimers = drafts.map((draft, index) =>
      setTimeout(() => {
        this.append([draft]);
        nextSlot = index + 1;
      }, index * delay),
    );
    this.pendingFlush = () => {
      if (nextSlot < drafts.length) this.append(drafts.slice(nextSlot));
    };
  }

  private flushPending(): void {
    if (!this.pendingFlush) return;
    this.pendingTimers.forEach(clearTimeout);
    this.pendingTimers = [];
    const flush = this.pendingFlush;
    this.pendingFlush = null;
    flush();
  }

  private append(drafts: DraftLine[]): void {
    const added = drafts.map((draft) => ({ ...draft, id: this.seq++ }));
    this.lines = pruneLines([...this.lines, ...added]);
    this.emit();
  }

  private emit(): void {
    this.options.onChange(this.getSnapshot());
  }
}

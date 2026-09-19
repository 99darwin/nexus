export { JevClient, JevApiError } from "./jev/client.js";
export type {
  JevQuestion,
  JevAnswer,
  NoulQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
  SystemOneResponse,
  JevClientOptions,
} from "./jev/client.js";

export {
  classifyItem,
  enrichItems,
  insertFeedItem,
  buildExcerpt,
  significanceFromScore,
  RELEVANCE_THRESHOLD,
  EXCERPT_MAX_CHARS,
} from "./jev/enrich.js";
export type { EnrichOptions, EnrichStats, FeedItemInsert } from "./jev/enrich.js";

export type { RawItem, SourceAdapter } from "./sources/types.js";

export { ArxivAdapter } from "./sources/arxiv.js";
export { HackerNewsAdapter } from "./sources/hackernews.js";
export { GitHubTrendingAdapter } from "./sources/github.js";
export { TwitterAdapter } from "./sources/twitter.js";
export { RssAdapter, RSS_FEEDS, safeUrl, isPublicHost } from "./sources/rss.js";
export type { RssFeed } from "./sources/rss.js";
export { TWITTER_ACCOUNTS } from "./sources/twitter-accounts.js";
export type { TwitterAccount } from "./sources/twitter-accounts.js";
export { BaseAdapter } from "./sources/base-adapter.js";
export type { AdapterOptions } from "./sources/base-adapter.js";

export { TimeoutError, sleep, withAbortTimeout } from "./abort.js";
export type { AbortTimeoutOptions } from "./abort.js";

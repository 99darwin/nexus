import type { RawItem } from "./sources/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

// ── Content-similarity dedup ────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "been", "some", "them",
  "than", "its", "over", "also", "that", "other", "into", "then", "about",
  "would", "this", "with", "from", "they", "will", "what", "when", "make",
  "like", "just", "more", "these", "very", "after", "most", "made", "such",
  "being", "their", "does", "could", "said", "each", "which", "she", "how",
  "who", "get", "got", "use", "using", "used", "new", "great", "really",
  "think", "know", "good", "much", "way", "even", "well", "here",
]);

const CONTENT_SIMILARITY_THRESHOLD = 0.6;

// ── Title entity dedup (cross-source) ──────────────────────────────────
// Extracts proper nouns + dollar amounts from titles so stories reported
// by multiple sources (different wording, same entities) get deduplicated.

const MIN_ENTITY_OVERLAP = 2;

const TITLE_COMMON_WORDS = new Set([
  "the", "this", "that", "what", "when", "where", "which", "how", "why",
  "new", "first", "last", "next", "big", "more", "most", "just", "now",
  "after", "before", "into", "over", "from", "with", "about", "here",
  "for", "and", "not", "all", "can", "has", "was", "are", "will", "get",
  "its", "our", "his", "her", "may", "could", "should", "would", "been",
  "says", "said", "according", "report", "sources", "via", "per", "use",
  "former", "chief", "company", "startup", "launches", "announces", "takes",
  "raises", "funding", "round", "series", "massive", "major", "top", "every",
  "best", "latest", "breaking", "exclusive", "update", "year", "today",
]);

/** Extract named entities (proper nouns + dollar amounts) from a title. */
export function extractTitleEntities(title: string): string[] {
  const entities: string[] = [];

  // Dollar amounts: "$1B", "$1 billion", "$500M" → normalized
  for (const match of title.matchAll(
    /\$\s*([\d,.]+)\s*(b|m|k|billion|million|thousand)?/gi,
  )) {
    const num = parseFloat(match[1].replace(/,/g, ""));
    const s = (match[2] ?? "").charAt(0).toLowerCase();
    if (s === "b") entities.push(`$${num}b`);
    else if (s === "m") entities.push(`$${num}m`);
    else if (s === "k" || s === "t") entities.push(`$${num}k`);
    else entities.push(`$${num}`);
  }

  // Proper nouns: capitalized words that aren't common English
  for (const word of title.split(/[^a-zA-Z0-9]+/)) {
    if (word.length < 2) continue;
    if (/^[A-Z]/.test(word) && !TITLE_COMMON_WORDS.has(word.toLowerCase())) {
      entities.push(word.toLowerCase());
    }
  }

  return [...new Set(entities)];
}

function entityOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  return a.filter((e) => setB.has(e)).length;
}

/** Extract sorted significant words from text for Jaccard comparison. */
export function contentFingerprint(text: string): string[] {
  const normalized = text
    .replace(/@[\w]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[\w]+/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  return [...new Set(words)].sort();
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let intersection = 0;
  for (const w of a) {
    if (setB.has(w)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Add content_fp and title_entities to each item's raw_metadata. */
export function addContentFingerprints(items: RawItem[]): RawItem[] {
  return items.map((item) => ({
    ...item,
    raw_metadata: {
      ...item.raw_metadata,
      content_fp: contentFingerprint(`${item.title} ${item.content}`),
      title_entities: extractTitleEntities(item.title),
    },
  }));
}

/**
 * Filter out items whose content or title entities match:
 *  1. another item in the same batch, or
 *  2. a recently-ingested item in PostgreSQL (72h window).
 *
 * Items must already have `content_fp` and `title_entities` in raw_metadata
 * (call addContentFingerprints first).
 */
export async function deduplicateByContent(
  items: RawItem[],
  pool: PgPool,
): Promise<RawItem[]> {
  if (items.length === 0) return [];

  // Defensive cap — O(n²) pairwise comparison must stay bounded
  const MAX_DEDUP_BATCH = 200;
  if (items.length > MAX_DEDUP_BATCH) {
    console.warn(`[dedup] capping ${items.length} items to ${MAX_DEDUP_BATCH}`);
    items = items.slice(0, MAX_DEDUP_BATCH);
  }

  // 1. Within-batch dedup — content similarity OR title entity overlap
  const unique: RawItem[] = [];
  for (const item of items) {
    const fp = item.raw_metadata.content_fp as string[];
    const entities = (item.raw_metadata.title_entities as string[]) ?? [];
    const isDup = unique.some((u) => {
      if (jaccardSimilarity(fp, u.raw_metadata.content_fp as string[]) > CONTENT_SIMILARITY_THRESHOLD) {
        return true;
      }
      const uEntities = (u.raw_metadata.title_entities as string[]) ?? [];
      return entityOverlap(entities, uEntities) >= MIN_ENTITY_OVERLAP;
    });
    if (!isDup) unique.push(item);
  }

  // 2. Against recent DB items (72h window for cross-source dedup)
  const MAX_RECENT = 5000;
  const result = await pool.query(
    `SELECT raw_metadata->'content_fp' AS fp,
            raw_metadata->'title_entities' AS entities
     FROM raw_items
     WHERE ingested_at > NOW() - INTERVAL '72 hours'
       AND raw_metadata ? 'content_fp'
     ORDER BY ingested_at DESC
     LIMIT $1`,
    [MAX_RECENT],
  );

  const recentItems: Array<{ fp: string[]; entities: string[] }> = result.rows.map(
    (r: { fp: string[] | null; entities: string[] | null }) => ({
      fp: Array.isArray(r.fp) ? r.fp : [],
      entities: Array.isArray(r.entities) ? r.entities : [],
    }),
  );

  if (recentItems.length === 0) return unique;

  return unique.filter((item) => {
    const fp = item.raw_metadata.content_fp as string[];
    const entities = (item.raw_metadata.title_entities as string[]) ?? [];
    return !recentItems.some((recent) => {
      if (jaccardSimilarity(fp, recent.fp) > CONTENT_SIMILARITY_THRESHOLD) return true;
      return entityOverlap(entities, recent.entities) >= MIN_ENTITY_OVERLAP;
    });
  });
}

// ── URL / title / arXiv ID dedup ────────────────────────────────────────

export async function deduplicateItems(items: RawItem[], pool: PgPool): Promise<RawItem[]> {
  if (items.length === 0) return [];

  const urls = items.map((item) => item.source_url);

  // Check which URLs already exist
  const result = await pool.query(`SELECT source_url FROM raw_items WHERE source_url = ANY($1)`, [
    urls,
  ]);

  const existingUrls = new Set<string>(
    result.rows.map((r: { source_url: string }) => r.source_url),
  );
  const newItems = items.filter((item) => !existingUrls.has(item.source_url));

  // Also do fuzzy title dedup within the last 24h
  if (newItems.length > 0) {
    const titles = newItems.map((item) => item.title);
    const fuzzyResult = await pool.query(
      `SELECT title FROM raw_items
       WHERE ingested_at > NOW() - INTERVAL '24 hours'
       AND title = ANY($1)`,
      [titles],
    );

    const existingTitles = new Set<string>(fuzzyResult.rows.map((r: { title: string }) => r.title));

    const afterTitle = newItems.filter((item) => !existingTitles.has(item.title));

    // arXiv ID dedup: filter items whose arXiv ID already exists in the database
    const arxivItems = afterTitle.filter((item) => item.raw_metadata?.arxiv_id);
    if (arxivItems.length > 0) {
      const arxivIds = arxivItems.map((item) => item.raw_metadata.arxiv_id as string);
      const arxivResult = await pool.query(
        `SELECT raw_metadata->>'arxiv_id' as arxiv_id FROM raw_items
         WHERE raw_metadata->>'arxiv_id' = ANY($1)`,
        [arxivIds],
      );
      const existingArxivIds = new Set<string>(
        arxivResult.rows.map((r: { arxiv_id: string }) => r.arxiv_id),
      );
      return afterTitle.filter(
        (item) => !item.raw_metadata?.arxiv_id || !existingArxivIds.has(item.raw_metadata.arxiv_id as string),
      );
    }

    return afterTitle;
  }

  return newItems;
}

const INSERT_BATCH_SIZE = 500;

export async function recordItems(items: RawItem[], pool: PgPool): Promise<void> {
  if (items.length === 0) return;

  for (let i = 0; i < items.length; i += INSERT_BATCH_SIZE) {
    const batch = items.slice(i, i + INSERT_BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const item of batch) {
      values.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
      );
      params.push(
        item.source,
        item.source_url,
        item.title,
        item.content,
        item.published_at,
        JSON.stringify(item.raw_metadata),
      );
    }

    await pool.query(
      `INSERT INTO raw_items (source, source_url, title, content, published_at, raw_metadata)
       VALUES ${values.join(", ")}
       ON CONFLICT (source_url) DO NOTHING`,
      params,
    );
  }
}

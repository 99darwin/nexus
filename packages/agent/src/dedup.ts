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

/** Add content_fp to each item's raw_metadata (non-destructive copy). */
export function addContentFingerprints(items: RawItem[]): RawItem[] {
  return items.map((item) => ({
    ...item,
    raw_metadata: {
      ...item.raw_metadata,
      content_fp: contentFingerprint(`${item.title} ${item.content}`),
    },
  }));
}

/**
 * Filter out items whose content is too similar to:
 *  1. another item in the same batch, or
 *  2. a recently-ingested item in PostgreSQL (24h window).
 *
 * Items must already have `content_fp` in raw_metadata (call addContentFingerprints first).
 */
export async function deduplicateByContent(
  items: RawItem[],
  pool: PgPool,
): Promise<RawItem[]> {
  if (items.length === 0) return [];

  // 1. Within-batch dedup — keep the first item in each similarity cluster
  const unique: RawItem[] = [];
  for (const item of items) {
    const fp = item.raw_metadata.content_fp as string[];
    const isDup = unique.some((u) =>
      jaccardSimilarity(fp, u.raw_metadata.content_fp as string[]) > CONTENT_SIMILARITY_THRESHOLD,
    );
    if (!isDup) unique.push(item);
  }

  // 2. Against recent DB items (capped to prevent memory exhaustion)
  const MAX_RECENT_FPS = 5000;
  const result = await pool.query(
    `SELECT raw_metadata->'content_fp' AS fp FROM raw_items
     WHERE ingested_at > NOW() - INTERVAL '24 hours'
       AND raw_metadata ? 'content_fp'
     ORDER BY ingested_at DESC
     LIMIT $1`,
    [MAX_RECENT_FPS],
  );

  const recentFps: string[][] = result.rows
    .map((r: { fp: string[] | null }) => r.fp)
    .filter((fp: string[] | null): fp is string[] => Array.isArray(fp));

  if (recentFps.length === 0) return unique;

  return unique.filter((item) => {
    const fp = item.raw_metadata.content_fp as string[];
    return !recentFps.some(
      (recent) => jaccardSimilarity(fp, recent) > CONTENT_SIMILARITY_THRESHOLD,
    );
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

import type { RawItem } from "./sources/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any;

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

    return newItems.filter((item) => !existingTitles.has(item.title));
  }

  return newItems;
}

export async function recordItems(items: RawItem[], pool: PgPool): Promise<void> {
  if (items.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const item of items) {
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

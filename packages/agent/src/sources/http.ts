/**
 * Bounded response reading, shared by every adapter that talks to an upstream.
 *
 * `response.json()` and `response.text()` buffer whatever arrives. Under chunked
 * encoding there is no `Content-Length` to check first, and a `Content-Length`
 * that *is* present is just a claim by the server — a compromised or broken
 * upstream can advertise 2 KB and stream gigabytes. Both cases exhaust memory
 * before the promise ever resolves, so the limit has to be enforced while
 * reading, not before it.
 *
 * Adapters are the only place untrusted bytes enter the process, so this is the
 * single chokepoint for that bound.
 */

/** Default ceiling for a JSON API response. Real ones are orders of magnitude smaller. */
export const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Read a response body as text, aborting once it exceeds `maxBytes`.
 *
 * Always releases the underlying stream, including on the over-limit and
 * mid-stream-error paths — an abandoned reader leaves the socket held open with
 * the server still writing into it.
 */
export async function readBoundedText(
  response: Response,
  options: { maxBytes?: number; label?: string } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_API_RESPONSE_BYTES;
  const label = options.label ?? "response";

  // No stream to meter. Real `fetch` always provides one for a non-204; the
  // bodiless case is a 204/HEAD or a caller handing us an already-buffered
  // Response, where `text()` reads from memory and there is nothing left to
  // bound. Falling back keeps the ceiling honest instead of pretending an
  // unmetered read was empty.
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`${label} too large: ${totalBytes}+ bytes (limit ${maxBytes})`);
      }
      chunks.push(value);
    }
  } finally {
    // Never let the release itself reject: cancelling an already-errored stream
    // surfaces as an unhandled rejection, which Node treats as fatal by default.
    await reader.cancel().catch(() => undefined);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Read a response body as JSON under the same byte ceiling.
 *
 * Parse failures carry the label and nothing from the body — upstream text is
 * untrusted, and an error page can echo back a request header, credentials
 * included. The status and the label are enough to diagnose with.
 */
export async function readBoundedJson<T>(
  response: Response,
  options: { maxBytes?: number; label?: string } = {},
): Promise<T> {
  const label = options.label ?? "response";
  const text = await readBoundedText(response, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: malformed JSON body`);
  }
}

/**
 * Drain and release a body we are not going to read (a redirect hop, an error
 * status). Without this the connection stays checked out until GC.
 */
export async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

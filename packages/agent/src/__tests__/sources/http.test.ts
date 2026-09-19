import { describe, it, expect } from "vitest";
import { discardBody, readBoundedJson, readBoundedText } from "../../sources/http.js";

/**
 * A response whose body streams `chunkCount` chunks of `chunkBytes` each, and
 * reports whether it was cancelled.
 *
 * `new Response(hugeString)` would allocate the whole payload up front, which is
 * exactly what these ceilings exist to prevent — so the test cannot build its
 * fixture that way either. Chunks are generated lazily instead.
 */
function streamingResponse(chunkCount: number, chunkBytes: number) {
  let cancelled = false;
  let produced = 0;
  const chunk = new Uint8Array(chunkBytes).fill(0x61); // "a"

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= chunkCount) {
        controller.close();
        return;
      }
      produced++;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    response: new Response(body),
    get cancelled() {
      return cancelled;
    },
    get produced() {
      return produced;
    },
  };
}

describe("readBoundedText", () => {
  it("stops reading once the byte ceiling is crossed", async () => {
    // Content-Length is absent under chunked encoding and is a server claim
    // either way, so the limit has to be enforced while reading. 100 chunks are
    // available; the limit should be hit around chunk 5.
    const fixture = streamingResponse(100, 1024);

    await expect(
      readBoundedText(fixture.response, { maxBytes: 5 * 1024, label: "feed" }),
    ).rejects.toThrow(/feed too large/);

    // The point of the ceiling: it did not buffer the whole stream first.
    expect(fixture.produced).toBeLessThan(100);
  });

  it("releases the stream on the over-limit path", async () => {
    // An abandoned reader leaves the socket held open with the server still
    // writing into it — the resource leak behind a slow-loris style stall.
    const fixture = streamingResponse(100, 1024);
    await readBoundedText(fixture.response, { maxBytes: 2 * 1024 }).catch(() => undefined);
    expect(fixture.cancelled).toBe(true);
  });

  it("returns the full body when it fits", async () => {
    const body = await readBoundedText(new Response("hello feed"), { maxBytes: 1024 });
    expect(body).toBe("hello feed");
  });

  it("does not reject when releasing an already-errored stream", async () => {
    // `reader.cancel()` on a broken stream rejects; unawaited or uncaught that
    // is an unhandled rejection, which Node treats as fatal by default.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });

    await expect(readBoundedText(new Response(body))).rejects.toThrow("connection reset");
  });
});

describe("readBoundedJson", () => {
  it("parses a bounded body", async () => {
    const parsed = await readBoundedJson<{ hits: number[] }>(
      new Response(JSON.stringify({ hits: [1, 2] })),
    );
    expect(parsed.hits).toEqual([1, 2]);
  });

  it("never puts the upstream body in the error message", async () => {
    // An error page can echo a request header back, Authorization included.
    const secret = "Bearer sk-live-should-never-surface";
    await expect(
      readBoundedJson(new Response(`<html>${secret}</html>`), { label: "X API" }),
    ).rejects.toThrow("X API: malformed JSON body");

    const err = await readBoundedJson(new Response(`<html>${secret}</html>`)).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).not.toContain("sk-live");
  });

  it("enforces the ceiling before parsing", async () => {
    const fixture = streamingResponse(100, 1024);
    await expect(
      readBoundedJson(fixture.response, { maxBytes: 4 * 1024, label: "github search" }),
    ).rejects.toThrow(/github search too large/);
  });
});

describe("discardBody", () => {
  it("releases a body we are not going to read", async () => {
    const fixture = streamingResponse(100, 1024);
    await discardBody(fixture.response);
    expect(fixture.cancelled).toBe(true);
  });

  it("is a no-op for a bodiless response", async () => {
    await expect(discardBody(new Response(null, { status: 204 }))).resolves.toBeUndefined();
  });
});

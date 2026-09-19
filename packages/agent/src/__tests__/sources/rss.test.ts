import { describe, it, expect, vi, beforeEach } from "vitest";
import { RssAdapter, isPublicHost, safeUrl, type LookupFn } from "../../sources/rss.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/**
 * Test hostnames resolve to a public address by default. Every adapter here is
 * built through makeAdapter so no test silently reaches real DNS — the SSRF
 * guard resolves each host before fetching.
 */
const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function makeAdapter(
  feeds?: Array<{ source: string; url: string }>,
  lookupImpl: LookupFn = publicLookup,
): RssAdapter {
  return new RssAdapter(feeds, { lookupImpl });
}

/** Mock Response with a streaming body, matching the adapter's reader usage. */
function mockResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(text) };
          },
          // Async, like the real one: the adapter awaits this in a `finally`,
          // and a sync `cancel` returning undefined would make that a TypeError
          // the fake hides.
          async cancel() {},
        };
      },
      // Present on a real body too — used to release a redirect or error body.
      async cancel() {},
    },
  };
}

const RSS_2_0 = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Acme launches a model</title>
      <link>https://acme.example/blog/model</link>
      <description><![CDATA[<p>Acme <b>shipped</b> something.</p>]]></description>
      <pubDate>Wed, 15 Jan 2025 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom post title</title>
    <link rel="alternate" href="https://simon.example/2025/atom-post"/>
    <summary>An atom summary &amp; entities.</summary>
    <published>2025-02-01T12:00:00Z</published>
  </entry>
</feed>`;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("RssAdapter", () => {
  it("parses RSS 2.0 items, unwraps CDATA and strips markup", async () => {
    mockFetch.mockResolvedValue(mockResponse(RSS_2_0));
    const adapter = makeAdapter([{ source: "acme", url: "https://acme.example/rss" }]);

    const items = await adapter.poll();

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("acme");
    expect(items[0].source_url).toBe("https://acme.example/blog/model");
    expect(items[0].title).toBe("Acme launches a model");
    expect(items[0].content).toBe("Acme shipped something.");
    expect(items[0].published_at).toBe("2025-01-15T00:00:00.000Z");
  });

  it("parses Atom entries, taking the href from rel=alternate", async () => {
    mockFetch.mockResolvedValue(mockResponse(ATOM));
    const adapter = makeAdapter([{ source: "simon", url: "https://simon.example/atom" }]);

    const items = await adapter.poll();

    expect(items).toHaveLength(1);
    expect(items[0].source_url).toBe("https://simon.example/2025/atom-post");
    expect(items[0].content).toBe("An atom summary & entities.");
    expect(items[0].published_at).toBe("2025-02-01T12:00:00.000Z");
  });

  it("keeps polling other feeds when one fails", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse("boom", false, 500))
      .mockResolvedValueOnce(mockResponse(ATOM));

    const adapter = makeAdapter([
      { source: "broken", url: "https://broken.example/rss" },
      { source: "simon", url: "https://simon.example/atom" },
    ]);

    const items = await adapter.poll();
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("simon");
  });

  it("skips entries missing a title or link", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(`<rss><channel>
        <item><title>No link here</title></item>
        <item><link>https://acme.example/no-title</link></item>
      </channel></rss>`),
    );
    const adapter = makeAdapter([{ source: "acme", url: "https://acme.example/rss" }]);

    expect(await adapter.poll()).toHaveLength(0);
  });

  it("deduplicates repeated urls across feeds", async () => {
    mockFetch.mockResolvedValue(mockResponse(RSS_2_0));
    const adapter = makeAdapter([
      { source: "a", url: "https://a.example/rss" },
      { source: "b", url: "https://b.example/rss" },
    ]);

    expect(await adapter.poll()).toHaveLength(1);
  });

  it("falls back to now() for an unparseable date", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(`<rss><channel><item>
        <title>Bad date</title>
        <link>https://acme.example/bad-date</link>
        <pubDate>not a date</pubDate>
      </item></channel></rss>`),
    );
    const adapter = makeAdapter([{ source: "acme", url: "https://acme.example/rss" }]);

    const items = await adapter.poll();
    expect(Number.isNaN(Date.parse(items[0].published_at))).toBe(false);
  });
});

describe("RssAdapter — untrusted input hardening", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects javascript: and data: links from Atom href attributes", async () => {
    const hostile = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Click me</title>
    <link rel="alternate" href="javascript:alert(1)"/>
  </entry>
  <entry>
    <title>Or me</title>
    <link rel="alternate" href="data:text/html,&lt;script&gt;"/>
  </entry>
  <entry>
    <title>Legit post</title>
    <link rel="alternate" href="https://ok.example/post"/>
  </entry>
</feed>`;
    mockFetch.mockResolvedValue(mockResponse(hostile));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/atom" }]);
    const items = await adapter.poll();

    expect(items).toHaveLength(1);
    expect(items[0].source_url).toBe("https://ok.example/post");
  });

  it("rejects links pointing at internal hosts", async () => {
    const ssrf = `<rss><channel>
      <item><title>Metadata</title><link>http://169.254.169.254/latest/meta-data/</link></item>
      <item><title>Loopback</title><link>http://127.0.0.1:8080/admin</link></item>
      <item><title>Fine</title><link>https://ok.example/a</link></item>
    </channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(ssrf));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items.map((i) => i.source_url)).toEqual(["https://ok.example/a"]);
  });

  it("refuses to follow a redirect to an internal address", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (h: string) => (h === "location" ? "http://169.254.169.254/" : null) },
    });

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items).toEqual([]);
    // The internal address is never requested.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("neutralizes entity-encoded markup instead of storing it as literal HTML", async () => {
    const encoded = `<rss><channel><item>
      <title>Post</title>
      <link>https://ok.example/a</link>
      <description>hi &lt;img src=x onerror=alert(1)&gt; there &amp; bye</description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(encoded));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items[0].content).not.toContain("<img");
    expect(items[0].content).not.toContain("onerror");
    expect(items[0].content).toContain("&"); // real entities still decode
  });

  it("parses a pathological feed in linear time", async () => {
    // 20k unmatched opening tags: quadratic backtracking took ~180ms here and
    // scales with the 10MB body cap. The linear scanner must not care.
    const hostile = "<item>".repeat(20_000) + "<title>x</title>";
    mockFetch.mockResolvedValue(mockResponse(hostile));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const start = Date.now();
    const items = await adapter.poll();
    const elapsed = Date.now() - start;

    expect(items).toEqual([]);
    expect(elapsed).toBeLessThan(1000);
  });

  it("stops after the per-feed cap instead of parsing the whole feed", async () => {
    const entry = (n: number) =>
      `<item><title>Post ${n}</title><link>https://ok.example/${n}</link></item>`;
    const huge = `<rss><channel>${Array.from({ length: 5000 }, (_, i) => entry(i)).join("")}</channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(huge));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items).toHaveLength(25);
    expect(items[0].source_url).toBe("https://ok.example/0");
  });

  it("truncates oversized fields", async () => {
    const long = "a".repeat(20_000);
    const feed = `<rss><channel><item>
      <title>${"t".repeat(2000)}</title>
      <link>https://ok.example/a</link>
      <description>${long}</description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items[0].title.length).toBeLessThanOrEqual(512);
    expect(items[0].content.length).toBeLessThanOrEqual(10_000);
  });
});

describe("isPublicHost", () => {
  it("rejects loopback and private addresses in every IPv4 notation", () => {
    for (const host of [
      "127.0.0.1",
      "2130706433", // decimal
      "0x7f000001", // hex
      "017700000001", // octal
      "127.1", // short form
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "localhost",
      "db.internal",
      "foo.local",
      "::1",
      "[::1]",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicHost(host), host).toBe(false);
    }
  });

  it("rejects a private IPv6 address in every spelling of it", () => {
    // Regression: the classifier matched string spellings, so only the
    // compressed form was caught. These are all the SAME addresses as the
    // rejected ones above, written differently.
    for (const host of [
      "0:0:0:0:0:0:0:1", // ::1 expanded
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "0:0:0:0:0:ffff:7f00:1", // ::ffff:127.0.0.1 expanded
      "0000:0000:0000:0000:0000:ffff:7f00:0001",
      "::ffff:7f00:1", // v4-mapped written as hex
      "::ffff:169.254.169.254", // cloud metadata, mapped
      "::ffff:a9fe:a9fe", // same, as hex
      "::ffff:10.0.0.1",
      "::ffff:0a00:1",
      "0:0:0:0:0:0:0:0", // :: expanded
      "fd00:0:0:0:0:0:0:1", // unique-local expanded
      "fe80:0:0:0:0:0:0:1", // link-local expanded
      "64:ff9b::7f00:1", // NAT64 wrapping loopback
      "not:a:v6", // unparseable but colon-bearing → fail closed
    ]) {
      expect(isPublicHost(host), host).toBe(false);
    }
  });

  it("accepts ordinary public hosts", () => {
    for (const host of [
      "example.com",
      "openai.com",
      "8.8.8.8",
      "172.32.0.1",
      "2600::1",
      "2600:0:0:0:0:0:0:1", // expanded public v6 stays public
      "::ffff:8.8.8.8", // v4-mapped public address
      "64:ff9b::808:808", // NAT64 wrapping a public v4
    ]) {
      expect(isPublicHost(host), host).toBe(true);
    }
  });
});

describe("safeUrl", () => {
  it("rejects non-http schemes, credentials, and internal targets", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("https://user:pass@example.com/")).toBeNull();
    expect(safeUrl("http://2130706433/latest/meta-data/")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });

  it("accepts ordinary feed URLs", () => {
    expect(safeUrl("https://example.com/feed.xml")).toBe("https://example.com/feed.xml");
    expect(safeUrl("  https://example.com/a  ")).toBe("https://example.com/a");
  });
});

describe("cleanHtml text fidelity", () => {
  it("keeps literal comparisons in CDATA while still stripping real tags", async () => {
    const feed = `<rss><channel><item>
      <title>Math post</title>
      <link>https://ok.example/math</link>
      <description><![CDATA[<p>when x < y and y > z, <b>swap</b> them</p>]]></description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    // CDATA exists to protect this literal text; a bare <[^>]*> strip ate it.
    expect(items[0].content).toBe("when x < y and y > z, swap them");
  });

  it("still strips entity-encoded script/img payloads", async () => {
    const feed = `<rss><channel><item>
      <title>XSS</title>
      <link>https://ok.example/x</link>
      <description>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;bad()&lt;/script&gt;ok</description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items[0].content).not.toContain("<img");
    expect(items[0].content).not.toContain("<script");
    expect(items[0].content).not.toContain("onerror");
    expect(items[0].content).toContain("ok");
  });
});

describe("RssAdapter — parser complexity re-review regressions", () => {
  beforeEach(() => mockFetch.mockReset());

  it("stays linear when only one entry tag prefix ever matches", async () => {
    // The first fix memoized nothing: `indexOf("<entry")` re-scanned to
    // end-of-input on every `<itemx>` the cursor stepped over, which is
    // quadratic. 40k filler tags near the 10MB body cap stalled the poll loop.
    const feed = `<rss><channel>${"<itemx>".repeat(40_000)}</channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const started = Date.now();
    const items = await adapter.poll();
    const elapsed = Date.now() - started;

    expect(items).toHaveLength(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("stays linear on <link> tags full of rel= fragments and no href", async () => {
    // `<link[^>]*\srel=…[^>]*\shref=…` let the two [^>]* sections backtrack
    // against each other across the whole entry when the href never arrives.
    const junk = `<link ${' rel="alternate"'.repeat(20_000)}`;
    const feed = `<rss><channel><item><title>t</title>${junk}</item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const started = Date.now();
    await adapter.poll();

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("finds an Atom href when rel= follows href in attribute order", async () => {
    const feed = `<?xml version="1.0"?><feed><entry>
      <title>Ordered</title>
      <link href="https://ok.example/post" rel="alternate"/>
    </entry></feed>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/atom" }]);
    const items = await adapter.poll();

    expect(items[0].source_url).toBe("https://ok.example/post");
  });

  it("neutralizes double-encoded markup", async () => {
    // One decode pass leaves `&lt;img …&gt;` in the database, which becomes a
    // live tag again if any downstream renderer decodes entities once more.
    const feed = `<rss><channel><item>
      <title>t</title>
      <link>https://ok.example/d</link>
      <description>&amp;lt;img src=x onerror=alert(1)&amp;gt;tail</description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items[0].content).not.toContain("onerror");
    expect(items[0].content).not.toContain("&lt;img");
    expect(items[0].content).toContain("tail");
  });

  it("strips newlines so feed content cannot forge a log line", async () => {
    const feed = `<rss><channel><item>
      <title>t</title>
      <link>https://ok.example/n</link>
      <description>first&#10;[poll:rss] fetched=9999 FORGED</description>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(mockResponse(feed));

    const adapter = makeAdapter([{ source: "x", url: "https://feed.example/rss" }]);
    const items = await adapter.poll();

    expect(items[0].content).not.toContain("\n");
  });
});

describe("RssAdapter — DNS-based SSRF", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // safeUrl() passes this: the host is syntactically a public DNS name.
    // Only resolution reveals 127.0.0.1. nip.io-style names make this trivial.
    expect(safeUrl("http://127.0.0.1.nip.io/feed")).not.toBeNull();

    const toLoopback: LookupFn = async () => [{ address: "127.0.0.1", family: 4 }];
    mockFetch.mockResolvedValue(mockResponse(RSS_2_0));

    const adapter = makeAdapter([{ source: "x", url: "http://127.0.0.1.nip.io/feed" }], toLoopback);
    const items = await adapter.poll();

    expect(items).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses names resolving to link-local metadata and RFC1918 space", async () => {
    for (const address of ["169.254.169.254", "10.0.0.5", "192.168.1.1", "172.16.0.1"]) {
      mockFetch.mockClear();
      const lookup: LookupFn = async () => [{ address, family: 4 }];
      const adapter = makeAdapter([{ source: "x", url: "https://metadata.example/feed" }], lookup);

      expect(await adapter.poll()).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it("refuses a name resolving to an IPv4-mapped IPv6 loopback", async () => {
    const lookup: LookupFn = async () => [{ address: "::ffff:127.0.0.1", family: 6 }];
    mockFetch.mockClear();
    const adapter = makeAdapter([{ source: "x", url: "https://sneaky.example/feed" }], lookup);

    expect(await adapter.poll()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses when ANY resolved address is private", async () => {
    // A split-horizon name with one public and one private record would
    // otherwise be a coin flip at connect time.
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    mockFetch.mockClear();
    const adapter = makeAdapter([{ source: "x", url: "https://split.example/feed" }], lookup);

    expect(await adapter.poll()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-resolves each redirect hop, not just the first", async () => {
    // The feed list is code-defined, but redirect targets are attacker-chosen.
    const lookup = vi.fn(async (hostname: string) =>
      hostname === "evil.example"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
    ) as unknown as LookupFn;

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: { get: (h: string) => (h === "location" ? "https://evil.example/internal" : null) },
    });

    const adapter = makeAdapter([{ source: "x", url: "https://good.example/feed" }], lookup);
    expect(await adapter.poll()).toHaveLength(0);
    // The redirect was fetched once; the loopback hop never was.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches normally when every address is public", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(RSS_2_0));

    const adapter = makeAdapter([{ source: "x", url: "https://good.example/feed" }]);
    expect(await adapter.poll()).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects both NAT64 prefixes, including the local-use one", async () => {
    // 64:ff9b::/96 is the well-known prefix and carries the v4 destination in
    // its last 32 bits, so a private embedded address must be caught there.
    // 64:ff9b:1::/48 (RFC 8215) is operator-local and its embedded v4 sits at a
    // prefix-length-dependent offset, so there is no field to validate — the
    // whole block is refused. Both are routes to a host's own translator.
    const cases = [
      "64:ff9b::7f00:1", // well-known prefix → 127.0.0.1
      "64:ff9b::a9fe:a9fe", // well-known prefix → 169.254.169.254 (metadata)
      "64:ff9b:1::7f00:1", // local-use prefix, embedded loopback
      "64:ff9b:1:ffff::1", // local-use prefix, any address at all
    ];

    for (const address of cases) {
      mockFetch.mockReset();
      const lookup = vi.fn(async () => [{ address, family: 6 }]) as unknown as LookupFn;
      const adapter = makeAdapter([{ source: "x", url: "https://nat64.example/feed" }], lookup);

      expect(await adapter.poll()).toHaveLength(0);
      expect(mockFetch, `${address} should never be fetched`).not.toHaveBeenCalled();
    }
  });

  it("still allows a NAT64 address carrying a public v4 destination", async () => {
    // The well-known-prefix check must reject on the embedded address, not on
    // the prefix — otherwise it is indistinguishable from a blanket ban.
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(RSS_2_0));
    const lookup = vi.fn(async () => [
      { address: "64:ff9b::5db8:d822", family: 6 }, // 93.184.216.34
    ]) as unknown as LookupFn;

    const adapter = makeAdapter([{ source: "x", url: "https://nat64.example/feed" }], lookup);
    expect(await adapter.poll()).toHaveLength(1);
  });

  it("refuses a hostname that does not resolve at all", async () => {
    const failing: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    mockFetch.mockClear();
    const adapter = makeAdapter([{ source: "x", url: "https://nxdomain.example/feed" }], failing);

    expect(await adapter.poll()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an empty resolution result", async () => {
    const empty: LookupFn = async () => [];
    mockFetch.mockClear();
    const adapter = makeAdapter([{ source: "x", url: "https://empty.example/feed" }], empty);

    expect(await adapter.poll()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

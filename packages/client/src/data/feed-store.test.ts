import { describe, expect, it } from "vitest";
import { isFeedItem, type FeedItem } from "./feed-types";
import { hotItems, mergeItems } from "./feed-store";

function item(id: string, publishedAt: string, significance: number | null = null): FeedItem {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    source: "example",
    published_at: publishedAt,
    excerpt: null,
    vertical: "foundation_models",
    event_type: "release",
    significance,
  };
}

describe("mergeItems (cursor pagination)", () => {
  it("appends the next page below the first, newest first", () => {
    const page1 = [item("a", "2026-09-18T12:00:00Z"), item("b", "2026-09-18T11:00:00Z")];
    const page2 = [item("c", "2026-09-18T10:00:00Z"), item("d", "2026-09-18T09:00:00Z")];

    expect(mergeItems(page1, page2).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("de-dupes on id across a cursor boundary and prefers the fresher row", () => {
    const loaded = [item("a", "2026-09-18T12:00:00Z")];
    const refreshed = [{ ...item("a", "2026-09-18T12:00:00Z"), title: "updated title" }];

    const merged = mergeItems(loaded, refreshed);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("updated title");
  });

  it("slots a refresh page above what is already scrolled", () => {
    const loaded = [item("b", "2026-09-18T11:00:00Z"), item("c", "2026-09-18T10:00:00Z")];
    const refresh = [item("a", "2026-09-18T13:00:00Z"), item("b", "2026-09-18T11:00:00Z")];

    expect(mergeItems(loaded, refresh).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the existing list untouched for an empty page", () => {
    const loaded = [item("a", "2026-09-18T12:00:00Z")];
    expect(mergeItems(loaded, [])).toBe(loaded);
  });

  it("breaks published_at ties deterministically", () => {
    const merged = mergeItems(
      [item("b", "2026-09-18T12:00:00Z")],
      [item("a", "2026-09-18T12:00:00Z")],
    );
    expect(merged.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("isFeedItem (api row guard)", () => {
  it("accepts a well-formed row", () => {
    expect(isFeedItem(item("a", "2026-09-18T12:00:00Z"))).toBe(true);
  });

  it("rejects the shapes that would crash a render", () => {
    expect(isFeedItem(null)).toBe(false);
    expect(isFeedItem(undefined)).toBe(false);
    expect(isFeedItem("a string")).toBe(false);
    expect(isFeedItem({})).toBe(false);
    expect(isFeedItem({ ...item("a", "2026-09-18T12:00:00Z"), title: { html: "<b>" } })).toBe(
      false,
    );
    expect(isFeedItem({ ...item("a", "2026-09-18T12:00:00Z"), id: 7 })).toBe(false);
  });

  it("rejects optional fields that would throw at render", () => {
    const row = item("a", "2026-09-18T12:00:00Z");
    expect(isFeedItem({ ...row, excerpt: { html: "<b>" } })).toBe(false);
    expect(isFeedItem({ ...row, vertical: 123 })).toBe(false);
    expect(isFeedItem({ ...row, event_type: [] })).toBe(false);
    expect(isFeedItem({ ...row, significance: "high" })).toBe(false);
    expect(isFeedItem({ ...row, significance: Number.NaN })).toBe(false);
  });

  it("accepts absent optional fields", () => {
    expect(
      isFeedItem({
        id: "a",
        title: "a",
        url: "https://example.com/a",
        source: "example",
        published_at: "2026-09-18T12:00:00Z",
      }),
    ).toBe(true);
  });
});

describe("hotItems", () => {
  it("takes the top five by significance and skips unscored rows", () => {
    const items = [
      item("low", "2026-09-18T12:00:00Z", 0.1),
      item("none", "2026-09-18T12:00:00Z", null),
      item("high", "2026-09-18T12:00:00Z", 0.9),
      item("mid", "2026-09-18T12:00:00Z", 0.5),
    ];

    expect(hotItems(items).map((i) => i.id)).toEqual(["high", "mid", "low"]);
    expect(hotItems(items, 2).map((i) => i.id)).toEqual(["high", "mid"]);
  });
});

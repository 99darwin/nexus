import { describe, it, expect } from "vitest";
import { extractTitleEntities, contentFingerprint } from "../dedup.js";

describe("extractTitleEntities", () => {
  it("extracts proper nouns and dollar amounts", () => {
    const entities = extractTitleEntities("Yann LeCun's AI startup raises $1B in Series A");
    expect(entities).toContain("yann");
    expect(entities).toContain("lecun");
    expect(entities).toContain("$1b");
    // "AI" is only 2 chars after split on non-alphanum, but matches /^[A-Z]/
    expect(entities).toContain("ai");
  });

  it("catches cross-source variant of the same story", () => {
    const a = extractTitleEntities("Yann LeCun's AI startup raises $1B in Series A");
    const b = extractTitleEntities("LeCun leaves Meta, new company secures $1 billion funding");
    const overlap = a.filter((e) => b.includes(e));
    expect(overlap.length).toBeGreaterThanOrEqual(2); // "lecun" + "$1b"
  });

  it("does NOT over-match unrelated stories about the same company", () => {
    const a = extractTitleEntities("OpenAI launches GPT-5 with advanced reasoning");
    const b = extractTitleEntities("OpenAI faces lawsuit over training data");
    const overlap = a.filter((e) => b.includes(e));
    // Only "openai" overlaps — different stories
    expect(overlap.length).toBeLessThan(2);
  });

  it("normalizes dollar amounts across formats", () => {
    const a = extractTitleEntities("Startup raises $1B");
    const b = extractTitleEntities("Company secures $1 billion");
    expect(a).toContain("$1b");
    expect(b).toContain("$1b");
  });

  it("filters out common English words", () => {
    const entities = extractTitleEntities("New Breaking Report Says Company Launches Update");
    // All words are in TITLE_COMMON_WORDS
    expect(entities).toEqual([]);
  });
});

describe("contentFingerprint", () => {
  it("produces consistent fingerprints", () => {
    const fp = contentFingerprint("Hello world test");
    expect(fp).toContain("hello");
    expect(fp).toContain("world");
    expect(fp).toContain("test");
  });
});

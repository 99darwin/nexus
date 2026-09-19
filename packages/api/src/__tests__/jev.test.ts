import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { systemOne, JevError, isNoulAnswer, isChoiceAnswer } from "../jev.js";

const mockFetch = vi.fn();

const QUESTIONS = {
  on_topic: { type: "noul" as const, instructions: "is this on topic?" },
};

const ok = (answers: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: async () => ({ model: "jev-latest", answers }),
});

const previousApiKey = process.env.TYPESAFE_API_KEY;

beforeAll(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (previousApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = previousApiKey;
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.TYPESAFE_API_KEY = "test-key";
});

describe("systemOne", () => {
  it("returns the answers map on success", async () => {
    mockFetch.mockResolvedValue(ok({ on_topic: { type: "noul", noul: 0.9 } }));

    const answers = await systemOne("funding rounds", QUESTIONS);

    expect(answers.on_topic).toEqual({ type: "noul", noul: 0.9 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fails fast when the api key is missing", async () => {
    delete process.env.TYPESAFE_API_KEY;

    await expect(systemOne("anything", QUESTIONS)).rejects.toBeInstanceOf(JevError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retries a 429 and succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(ok({ on_topic: { type: "noul", noul: 0.7 } }));

    const answers = await systemOne("funding rounds", QUESTIONS);

    expect(answers.on_topic).toEqual({ type: "noul", noul: 0.7 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget on a persistent 429", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    await expect(systemOne("funding rounds", QUESTIONS)).rejects.toMatchObject({ status: 429 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["401 — a bad key stays bad", { ok: false, status: 401, json: async () => ({}) }],
    ["500 — not on the retryable list", { ok: false, status: 500, json: async () => ({}) }],
    [
      "an unparseable 200 body",
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      },
    ],
    ["a 200 with no answers map", { ok: true, status: 200, json: async () => ({ model: "x" }) }],
  ])("does not retry %s", async (_label, response) => {
    mockFetch.mockResolvedValue(response);

    await expect(systemOne("funding rounds", QUESTIONS)).rejects.toBeInstanceOf(JevError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a network error", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok({ on_topic: { type: "noul", noul: 0.5 } }));

    await expect(systemOne("funding rounds", QUESTIONS)).resolves.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends the key only in the Authorization header", async () => {
    mockFetch.mockResolvedValue(ok({ on_topic: { type: "noul", noul: 0.9 } }));

    await systemOne("funding rounds", QUESTIONS);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("systemone");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.body).not.toContain("test-key");
    expect(JSON.parse(init.body).model).toBe("jev-latest");
  });
});

describe("answer guards", () => {
  it("accepts well-formed answers and rejects everything else", () => {
    expect(isNoulAnswer({ type: "noul", noul: 0.5 })).toBe(true);
    expect(isNoulAnswer(undefined)).toBe(false);
    // A choice answer must not pass the noul guard, or a malformed upstream
    // payload would be read as a topicality score.
    expect(isNoulAnswer({ type: "choice", choice: "a", probabilities: {}, confidence: 1 })).toBe(
      false,
    );

    expect(isChoiceAnswer({ type: "choice", choice: "a", probabilities: {}, confidence: 1 })).toBe(
      true,
    );
    expect(isChoiceAnswer({ type: "noul", noul: 0.5 })).toBe(false);
  });
});

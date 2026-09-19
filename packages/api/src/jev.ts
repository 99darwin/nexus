/**
 * Minimal Jev (TypeSafe System One) client.
 *
 * Jev is a *decision* model: it answers typed questions (Noul / Choice /
 * Score) about a state and returns structured JSON. It generates no free
 * text, which is why the chat route can hand it raw user input without a
 * prompt-injection surface — there is nothing to inject into.
 *
 * Deliberately local to packages/api (no import from packages/agent): the
 * API only needs the question types the chat route asks, and coupling the
 * HTTP surface to the ingestion package would drag its deps along.
 *
 * env: TYPESAFE_API_KEY (required — callers get a JevError without it)
 */

const JEV_URL = process.env.TYPESAFE_API_URL ?? "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

/** Status codes worth a retry — rate limited and overloaded, per the API docs. */
const RETRYABLE_STATUSES = new Set([429, 529]);

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option key → description (null when the key speaks for itself) */
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask Jev one or more typed questions about `state`.
 *
 * Throws JevError on auth failure (401 — never retried, the key is wrong),
 * on exhausted retries, and on malformed responses. Callers are expected to
 * translate that into an opaque 502 rather than surfacing the detail.
 */
export async function systemOne(
  state: string,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new JevError("TYPESAFE_API_KEY is not configured");

  const body = JSON.stringify({ state, model: JEV_MODEL, questions });

  let lastError: JevError = new JevError("jev request failed");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(JEV_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body,
      });

      if (response.status === 401) {
        // Non-retryable: a bad key will still be bad in 250ms.
        throw new JevError("jev rejected the api key", 401);
      }

      if (!response.ok) {
        lastError = new JevError(`jev responded ${response.status}`, response.status);
        if (!RETRYABLE_STATUSES.has(response.status)) throw lastError;
      } else {
        let payload: Partial<JevResponse>;
        try {
          payload = (await response.json()) as Partial<JevResponse>;
        } catch {
          // A 200 whose body will not parse is a deterministic upstream fault.
          // Raised as a JevError so the retry loop treats it as terminal
          // instead of spending two more attempts on the same bad response.
          throw new JevError("jev returned unparseable json");
        }
        if (!payload || typeof payload.answers !== "object" || payload.answers === null) {
          throw new JevError("jev returned a malformed response");
        }
        return payload.answers;
      }
    } catch (error) {
      if (error instanceof JevError) {
        if (error.status === undefined || !RETRYABLE_STATUSES.has(error.status)) throw error;
        lastError = error;
      } else {
        // Network error or timeout — retryable.
        lastError = new JevError(error instanceof Error ? error.message : "jev request failed");
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }

  throw lastError;
}

export function isNoulAnswer(answer: JevAnswer | undefined): answer is NoulAnswer {
  return answer?.type === "noul" && typeof answer.noul === "number";
}

export function isChoiceAnswer(answer: JevAnswer | undefined): answer is ChoiceAnswer {
  return answer?.type === "choice" && typeof answer.choice === "string";
}

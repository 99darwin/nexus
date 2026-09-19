import { describe, it, expect, vi } from "vitest";
import { TimeoutError, sleep, withAbortTimeout } from "../abort.js";

describe("withAbortTimeout", () => {
  it("rejects a late SUCCESS instead of resolving it", async () => {
    // The whole point of the deadline. An operation that ignores its signal and
    // then resolves happily at 40ms under a 5ms deadline has produced the result
    // of a cycle that was already abandoned — downstream stages would run on it
    // and the log would read as a clean poll, so the deadline would be toothless
    // against exactly the implementations it exists to bound.
    let settled = false;
    const promise = withAbortTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        settled = true;
        return "late-success";
      },
      { ms: 5, label: "late" },
    );

    await expect(promise).rejects.toThrow(TimeoutError);
    // ...and it waited for the real settlement rather than abandoning it. That
    // ordering is what makes a mutex around this safe.
    expect(settled).toBe(true);
  });

  it("does not settle until the operation really settles", async () => {
    // The mutex invariant: a caller holding a lock keeps holding it until the
    // work has actually stopped, so the deadline cannot release the lock while
    // the previous cycle is still writing.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let wrapperSettled = false;
    const promise = withAbortTimeout(
      async () => {
        await gate;
        return "done";
      },
      { ms: 5 , label: "gated" },
    ).catch(() => {
      wrapperSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    // Deadline long gone, operation still running — wrapper must still be pending.
    expect(wrapperSettled).toBe(false);

    release();
    await promise;
    expect(wrapperSettled).toBe(true);
  });

  it("resolves a normal success", async () => {
    await expect(
      withAbortTimeout(async () => "ok", { ms: 1_000, label: "fast" }),
    ).resolves.toBe("ok");
  });

  it("reports the deadline as the deadline when the operation observes it", async () => {
    const err = await withAbortTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
        }),
      { ms: 5, label: "poll:rss" },
    ).catch((e: Error) => e);

    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.message).toContain("poll:rss timed out after 5ms");
  });

  it("keeps a real failure as the cause when the operation ignored the deadline", async () => {
    // Relabelling "Connection terminated" as "timed out" would throw away the
    // only evidence of what actually broke.
    const err = await withAbortTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("Connection terminated");
      },
      { ms: 5, label: "poll:pg" },
    ).catch((e: Error) => e);

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err.cause as Error).message).toBe("Connection terminated");
  });

  it("preserves a parent abort's own reason rather than calling it a timeout", async () => {
    const parent = new AbortController();
    const reason = new Error("shutting down (SIGTERM)");
    const promise = withAbortTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
        }),
      { ms: 10_000, label: "poll:rss", parent: parent.signal },
    );

    parent.abort(reason);
    await expect(promise).rejects.toThrow("shutting down (SIGTERM)");
  });

  it("resolves a success that lands after a PARENT abort", async () => {
    // Asymmetric to the timeout case on purpose: "shutdown asked us to stop and
    // the work finished anyway" is a completed unit of work worth reporting as
    // done. When the parent is itself a deadline, its own wrapper applies the
    // timeout rule one level up, so nothing slips through.
    const parent = new AbortController();
    const promise = withAbortTimeout(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "finished anyway";
      },
      { ms: 10_000, label: "poll:rss", parent: parent.signal },
    );

    parent.abort(new Error("shutting down"));
    await expect(promise).resolves.toBe("finished anyway");
  });

  it("survives a throwing onTimeout instead of dying on the timer macrotask", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const promise = withAbortTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
        }),
      {
        ms: 5,
        label: "noisy",
        onTimeout: () => {
          throw new Error("diagnostics blew up");
        },
      },
    );

    await expect(promise).rejects.toThrow(TimeoutError);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("sleep", () => {
  it("rejects as soon as the signal aborts rather than serving out the delay", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const started = Date.now();
    const promise = sleep(60_000, controller.signal);

    controller.abort(reason);
    await expect(promise).rejects.toThrow("cancelled");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("rejects immediately when handed an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already gone"));
    await expect(sleep(60_000, controller.signal)).rejects.toThrow("already gone");
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import "./chat.css";
import { MAX_CHAT_INPUT_LENGTH, postChat } from "../data/feed-client";
import {
  ChatSession,
  PLACEHOLDER_INTERVAL_MS,
  PLACEHOLDER_PROMPTS,
  type ChatLine,
  type ChatSnapshot,
} from "./chat-logic";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ChatBox({ active }: { active: boolean }) {
  const sessionRef = useRef<ChatSession | null>(null);
  // the session is built inside the lazy initializer so it exists exactly once,
  // and seeds the first snapshot with the greeting lines
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => {
    const session = new ChatSession({
      post: postChat,
      onChange: (next) => setSnapshot(next),
      reducedMotion: prefersReducedMotion(),
    });
    sessionRef.current = session;
    return session.getSnapshot();
  });
  const [value, setValue] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // cancel in-flight reveal timers on unmount (the session itself stays reusable,
  // so strict-mode's double effect cycle is harmless)
  useEffect(() => () => sessionRef.current?.dispose(), []);

  // rotating suggested-prompt placeholder — pauses while focused, non-empty, or
  // while the section is off-screen (an inert panel has nothing to animate)
  const paused = isFocused || value.length > 0 || !active;
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setPlaceholderIndex((index) => (index + 1) % PLACEHOLDER_PROMPTS.length),
      PLACEHOLDER_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [paused]);

  // keep the newest line in view
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [snapshot]);

  // preventScroll: focusing mid-slide would otherwise scroll the transform away
  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      // returns false when a reply is already in flight — the reentrancy guard
      if (sessionRef.current?.submit(value)) setValue("");
    },
    [value],
  );

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label="transcript">
        {snapshot.lines.map((line) => (
          <ChatLineView key={line.id} line={line} />
        ))}
        {snapshot.thinking && (
          // role="status" carries the name; aria-label on a bare <p> exposes nothing
          <p className="chat-line chat-line-dim" role="status" aria-label="thinking">
            …
          </p>
        )}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={PLACEHOLDER_PROMPTS[placeholderIndex]}
          maxLength={MAX_CHAT_INPUT_LENGTH}
          autoComplete="off"
          spellCheck={false}
          aria-label="ask about indexed ai news"
        />
        <button className="chat-send" type="submit" disabled={snapshot.awaiting}>
          send
        </button>
      </form>
    </div>
  );
}

function ChatLineView({ line }: { line: ChatLine }) {
  if (line.kind === "link" && line.href) {
    return (
      <p className="chat-line chat-line-link">
        <a href={line.href} target="_blank" rel="noopener noreferrer">
          {line.text}
        </a>
      </p>
    );
  }
  return <p className={`chat-line chat-line-${line.kind}`}>{line.text}</p>;
}

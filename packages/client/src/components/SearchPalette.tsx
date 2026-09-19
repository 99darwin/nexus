import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "../data/feed-types";
import { useSearch } from "../hooks/useSearch";
import { relativeTime } from "../data/time";
import { nodeColor, verticalLabel } from "../theme/vertical-colors";

interface SearchPaletteProps {
  /** items currently loaded into the feed — search is client-side only */
  items: FeedItem[];
  onSelect: (itemId: string) => void;
  onClose: () => void;
}

const LISTBOX_ID = "palette-listbox";
const optionId = (index: number) => `palette-option-${index}`;

export function SearchPalette({ items, onSelect, onClose }: SearchPaletteProps) {
  const { query, results, search, clear } = useSearch(items);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  /* modal focus handling: take focus on open, hand it back on close. without the
   * restore, dismissing the palette drops keyboard users at the top of the page. */
  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  /* dom focus stays in the input under the activedescendant model, so the browser
   * no longer scrolls the active row into view for free — arrowing past the fold
   * would otherwise select, and enter would open, a row nobody can see. */
  useEffect(() => {
    document.getElementById(optionId(selectedIndex))?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const choose = (itemId: string) => {
    onSelect(itemId);
    clear();
    onClose();
  };

  /* the dialog holds exactly two tab stops (input, close) — wrapping between them
   * keeps tab from walking into the inert page behind the overlay. */
  const trapTab = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const target =
      document.activeElement === inputRef.current ? closeRef.current : inputRef.current;
    target?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const selected = results[selectedIndex];
      if (selected) {
        event.preventDefault();
        choose(selected.item.id);
      }
    }
  };

  const activeOption = results[selectedIndex] ? optionId(selectedIndex) : undefined;

  /* click-outside dismisses, but a text selection dragged out of the input and
   * released on the overlay also fires click here — only the press that *started*
   * on the overlay counts as "outside". */
  const pressedOutside = useRef(false);

  return (
    <div
      className="palette-overlay"
      role="presentation"
      onMouseDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOutside.current) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="search the feed"
        onKeyDown={trapTab}
      >
        <div className="palette-head">
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="search loaded items"
            aria-label="search loaded items"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={activeOption}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <button ref={closeRef} type="button" className="palette-close" onClick={onClose}>
            close
          </button>
        </div>
        <ul className="palette-results" id={LISTBOX_ID} role="listbox" aria-label="results">
          {results.map((result, index) => (
            <li
              key={result.item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              className={
                index === selectedIndex ? "palette-result palette-result-active" : "palette-result"
              }
              onClick={() => choose(result.item.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span
                className="chip-swatch"
                style={{ background: nodeColor(result.item.vertical) }}
                aria-hidden="true"
              />
              <span className="palette-result-title">{result.item.title}</span>
              <span className="feed-item-meta">
                {verticalLabel(result.item.vertical)} · {relativeTime(result.item.published_at)}
              </span>
            </li>
          ))}
        </ul>
        {query.trim() !== "" && results.length === 0 && (
          <p className="palette-empty">no matches in loaded items</p>
        )}
      </div>
    </div>
  );
}

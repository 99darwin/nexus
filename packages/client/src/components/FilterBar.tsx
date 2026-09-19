import type { FeedMeta } from "../data/feed-types";
import { VERTICALS, nodeColor } from "../theme/vertical-colors";

const EVENT_TYPES = [
  "launch",
  "release",
  "funding",
  "acquisition",
  "paper",
  "update",
  "shutdown",
] as const;

interface FilterBarProps {
  meta: FeedMeta | null;
  activeVertical: string | null;
  activeEventType: string | null;
  onVerticalToggle: (vertical: string) => void;
  onEventTypeToggle: (eventType: string) => void;
  onClearFilters: () => void;
}

/** Facets are single-select per row: the api takes one `vertical` and one
 * `event_type`, so the chips map 1:1 onto query params. */
export function FilterBar({
  meta,
  activeVertical,
  activeEventType,
  onVerticalToggle,
  onEventTypeToggle,
  onClearFilters,
}: FilterBarProps) {
  const hasFilters = activeVertical !== null || activeEventType !== null;

  // an unindexed facet has nothing to show; keep an active chip visible so it
  // can always be switched off
  const verticals = VERTICALS.filter(
    (v) => (meta?.verticals[v.vertical] ?? 0) > 0 || v.vertical === activeVertical,
  );
  const eventTypes = EVENT_TYPES.filter(
    (type) => (meta?.event_types[type] ?? 0) > 0 || type === activeEventType,
  );

  return (
    <div className="filter-bar">
      {eventTypes.length > 0 && (
        <div className="chip-row" role="group" aria-label="filter by event type">
          <span className="chip-row-label">type</span>
          {eventTypes.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              aria-pressed={activeEventType === type}
              onClick={() => onEventTypeToggle(type)}
            >
              <span>{type}</span>
              {meta?.event_types[type] ? (
                <span className="chip-count">{meta.event_types[type]}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {verticals.length > 0 && (
        <div className="chip-row" role="group" aria-label="filter by vertical">
          <span className="chip-row-label">vertical</span>
          {verticals.map((v) => (
            <button
              key={v.vertical}
              type="button"
              className="chip"
              aria-pressed={activeVertical === v.vertical}
              onClick={() => onVerticalToggle(v.vertical)}
            >
              <span
                className="chip-swatch"
                style={{ background: nodeColor(v.vertical) }}
                aria-hidden="true"
              />
              <span>{v.label}</span>
              {meta?.verticals[v.vertical] ? (
                <span className="chip-count">{meta.verticals[v.vertical]}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {hasFilters && (
        <div className="chip-row">
          <button type="button" className="chip chip-clear" onClick={onClearFilters}>
            clear filters
          </button>
        </div>
      )}
    </div>
  );
}

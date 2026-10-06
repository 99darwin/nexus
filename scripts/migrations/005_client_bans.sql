-- Clients refused at the door, before any route or query runs. Two writers:
--
--   * the API, when a client escalates to a long /mcp ban (reason says so);
--   * an operator, by hand, for anyone else. NULL banned_until is permanent.
--
-- client_key is the API's rate-limit identity (packages/api/src/client-key.ts):
-- an IPv4 address as-is, an IPv6 address collapsed to its /64 prefix
-- with all four groups spelled out ("2001:db8:0:1::/64"). The API reloads
-- this table every minute.

CREATE TABLE IF NOT EXISTS client_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  banned_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_bans_banned_until ON client_bans(banned_until);

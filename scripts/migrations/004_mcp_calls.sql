-- Agent usage of the public /mcp endpoint. One row per JSON-RPC request
-- (notifications excluded). No IP or request payload is stored: method,
-- tool name, and the client's self-reported name/version only.
--
-- client_name is only present on `initialize` — the endpoint is stateless,
-- so a later tools/call can't be tied back to the client that made it.

CREATE TABLE IF NOT EXISTS mcp_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method TEXT NOT NULL,
  tool TEXT,
  client_name TEXT,
  client_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_calls_created_at ON mcp_calls(created_at);

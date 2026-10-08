BEGIN;

CREATE TABLE IF NOT EXISTS auth_token_families (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_token_families_expires_at ON auth_token_families(expires_at);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  family_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS family_id UUID;

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_family_id ON revoked_tokens(family_id);

COMMIT;
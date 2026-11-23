-- 005_oidc.sql — PocketID / OpenID Connect sign-in.
--
-- An identity maps one external OIDC subject to one Kapo user. The provider is
-- the issuer URL rather than a generic label: changing KAPO_OIDC_ISSUER must
-- not silently reuse subject mappings from a different identity provider.
--
-- A user has at most one identity per provider; an external subject belongs to
-- exactly one Kapo user. Kapo users and sessions stay local, so permissions,
-- guards and API routes are unchanged.

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_at_link TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  UNIQUE (provider, subject),
  UNIQUE (provider, user_id)
);

CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);

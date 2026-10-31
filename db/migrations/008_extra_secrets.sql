-- ============================================================================
-- Secondary (non-primary) secrets for a provider.
--
-- Some providers need more than one credential — WhatsApp, for example, needs a
-- Graph API access token AND an app secret for verifying webhook payloads.
-- `config` is plaintext JSONB and must never hold a secret, so additional
-- secrets get their own encrypted column, keyed by field name.
-- ============================================================================

alter table provider_credentials
  add column if not exists extra_secrets_encrypted jsonb;

comment on column provider_credentials.config is
  'Non-secret settings only (ids, base urls, display numbers). Never store a secret here.';
comment on column provider_credentials.extra_secrets_encrypted is
  'AES-256-GCM ciphertext per field, shape: { "<field>": "base64(iv||ct||tag)" }. Decrypted server-side only.';
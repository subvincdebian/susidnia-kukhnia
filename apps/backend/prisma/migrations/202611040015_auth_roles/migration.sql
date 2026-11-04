BEGIN;
CREATE TABLE app_users (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_user_role CHECK (role IN ('admin','user')),
  CONSTRAINT app_user_email_lowercase CHECK (email=lower(email))
);
CREATE TABLE auth_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT auth_session_expiry CHECK (expires_at>created_at),
  CONSTRAINT auth_session_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
COMMIT;

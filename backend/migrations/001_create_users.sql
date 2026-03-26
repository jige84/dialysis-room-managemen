-- 001_create_users.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  real_name     VARCHAR(50) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','doctor','nurse','head_nurse','qc')),
  is_active     BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

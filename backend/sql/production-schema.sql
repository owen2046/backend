-- Run this entire file once in Neon SQL Editor for a fresh production database.

CREATE TABLE IF NOT EXISTS builders (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  badge           TEXT,
  since           TEXT,
  logo_url        TEXT,
  description     TEXT,
  website         TEXT,
  projects_count  INTEGER DEFAULT 0,
  city            TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id              TEXT PRIMARY KEY,
  builder_id      TEXT REFERENCES builders(id) ON DELETE SET NULL,
  builder_name    TEXT,
  name            TEXT NOT NULL,
  location        TEXT,
  type            TEXT,
  status          TEXT,
  bhk             TEXT,
  price           TEXT,
  area            TEXT,
  img             TEXT,
  images          TEXT[],
  description     TEXT,
  amenities       TEXT[],
  nearby          TEXT[],
  total_units     INTEGER DEFAULT 0,
  sold_units      INTEGER DEFAULT 0,
  possession      TEXT,
  rera            TEXT,
  tag             TEXT,
  floor_plan_url  TEXT,
  floor_plan_code TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  content       TEXT,
  author        TEXT,
  category      TEXT,
  img           TEXT,
  read_time     TEXT,
  published_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inquiries (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  message       TEXT,
  interest      TEXT,
  budget        TEXT,
  city          TEXT,
  property_id   TEXT REFERENCES properties(id) ON DELETE SET NULL,
  property_name TEXT,
  source        TEXT DEFAULT 'website',
  page_path     TEXT,
  request_type  TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  status        TEXT DEFAULT 'new',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_properties (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  property_id  TEXT REFERENCES properties(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, property_id)
);

CREATE TABLE IF NOT EXISTS admins (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_builder_id ON properties (builder_id);
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON properties (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status);
CREATE INDEX IF NOT EXISTS idx_inquiries_source ON inquiries (source);
CREATE INDEX IF NOT EXISTS idx_saved_properties_user_id ON saved_properties (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_properties_property_id ON saved_properties (property_id);

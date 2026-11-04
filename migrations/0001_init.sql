-- the videos and books in the index
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'book')),
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  url TEXT,
  language TEXT,
  year INTEGER,
  country TEXT NOT NULL DEFAULT '*',
  typology TEXT NOT NULL DEFAULT '*',
  summary TEXT,
  chunks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sources_author ON sources (author);

-- facts written into Keystone's knowledge base, in its shape; evidence is a JSON array of { source, where, kind, quote }
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  q TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '*',
  typology TEXT NOT NULL DEFAULT '*',
  en TEXT NOT NULL,
  value TEXT NOT NULL,
  target TEXT,
  evidence TEXT NOT NULL,
  agree INTEGER NOT NULL DEFAULT 1,
  review TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS facts_question ON facts (category, q, country, typology);

-- paid model calls per day, for the cap
CREATE TABLE IF NOT EXISTS usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);

-- precedents: competition entries (or any built or unbuilt work) with pictures and the jury's written assessment of them.
-- The jury's text is embedded in Vectorize (kind 'precedent', sourceId = the precedent's id); the pictures are kept here,
-- downscaled at ingestion, and shown to the model next to the views of the user's project. No office or author is stored:
-- a precedent is named by a neutral label ("Hospital, 1st prize, 2024").
CREATE TABLE IF NOT EXISTS precedents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  typology TEXT NOT NULL DEFAULT '*',
  country TEXT NOT NULL DEFAULT '*',
  year INTEGER,
  prize TEXT,
  url TEXT,
  jury TEXT NOT NULL,
  language TEXT,
  images INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- each picture as a base64 JPEG, PNG or WebP (at most ~1.5 MB, so a row stays well under D1's limit)
CREATE TABLE IF NOT EXISTS precedent_images (
  precedent_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  label TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (precedent_id, n)
);

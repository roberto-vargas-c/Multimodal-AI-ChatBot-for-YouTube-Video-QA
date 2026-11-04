-- copyrighted books go into an owner-only Vectorize index; the public endpoints list and search only sources with private = 0
ALTER TABLE sources ADD COLUMN private INTEGER NOT NULL DEFAULT 0;

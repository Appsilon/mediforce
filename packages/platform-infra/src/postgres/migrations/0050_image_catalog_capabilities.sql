ALTER TABLE "image_catalog_entries"
  ADD COLUMN "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Workspace branding: per-workspace logo image + main/auxiliary brand colors.
--
-- `logo` stores an optimised image inline as a base64 `data:` URL so it travels
-- with the already-authenticated namespace payloads and renders via a plain
-- `<img src>` (Zod caps it at ~512 KiB of characters). `brand_primary_color` /
-- `brand_accent_color` are `#rrggbb` hex strings the UI converts to HSL triples
-- to override the `--primary` / `--accent` design tokens app-wide.
--
-- All three are nullable — existing workspaces keep the Lucide icon + platform
-- default palette until branding is set.

ALTER TABLE "workspaces" ADD COLUMN "logo" text;
ALTER TABLE "workspaces" ADD COLUMN "brand_primary_color" text;
ALTER TABLE "workspaces" ADD COLUMN "brand_accent_color" text;

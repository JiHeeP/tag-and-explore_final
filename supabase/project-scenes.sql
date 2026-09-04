-- Multi-scene projects for Tag and Explore (ThingLink-style scene transitions).
--
-- Run this in the Supabase SQL editor for the `thinglink` project before
-- saving projects that contain more than one scene.
--
-- What it does:
-- - Adds an optional `scenes` JSONB column to `projects`.
-- - Leaves every existing column, row, and RLS policy untouched.
--
-- How the app uses it:
-- - `scenes` is an ordered array. Each item looks like
--   { "id", "name", "backgroundType", "imageUrl", "hotspots": [...],
--     "sourceProvider", "sourceLat", "sourceLng", ... }
-- - Hotspots with "contentType": "scene" carry "targetSceneId" and move the
--   viewer to that scene when clicked.
-- - `image_url`, `background_type`, `hotspots`, and `source_*` keep mirroring
--   scene 1, so older bundles and the home cards continue to work.
-- - Rows where `scenes` is NULL are treated as a single-scene project built
--   from the flat columns. No backfill is required.

alter table public.projects
  add column if not exists scenes jsonb;

comment on column public.projects.scenes is
  'Ordered scene list for multi-scene projects. NULL means a single scene defined by image_url/background_type/hotspots.';

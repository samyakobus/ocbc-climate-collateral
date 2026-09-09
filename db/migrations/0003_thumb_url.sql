-- 0003_thumb_url.sql - S43. The per-property satellite thumbnail's source URL.
--
-- WHY A THIRD MIGRATION RATHER THAN AN EDIT TO 0001.
-- `scripts/db-migrate.ts` records each applied file with its CHECKSUM, so a
-- database that has already run `0001_schema.sql` would report a checksum
-- mismatch rather than pick up an added column. A new file applies cleanly to a
-- fresh clone and to every existing instance, which is the whole point of
-- numbering them.
--
-- WHY THE COLUMN EXISTS.
-- `collateral.satellite_thumb_path` says which cached file the case screen
-- renders. It does not say where that image came from, and `/api/refresh/thumbs`
-- needs to know: the refresh re-fetches whatever the row records rather than
-- rebuilding a URL of its own, for the same reason the tile refresh substitutes
-- the date segment of the stored `live_url` instead of composing one. Two places
-- that know how to address the imagery service is one place too many, and they
-- drift the first time a layer or a zoom changes.
--
-- It also carries the upgrade path. Without `GOOGLE_MAPS_STATIC_KEY` the prep
-- pipeline writes a NASA GIBS URL here, which is regional imagery at zoom 8. Run
-- the pipeline with a key and this column holds a Google Maps Static URL at the
-- property's own coordinates, and the refresh route follows it with no code
-- change.
--
-- NULLABLE on purpose. The synthetic floor writes placeholder images with no
-- source at all, and a property with no URL must degrade to "showing the cached
-- image" rather than to a broken refresh.

ALTER TABLE collateral
  ADD COLUMN IF NOT EXISTS satellite_thumb_url TEXT;

COMMENT ON COLUMN collateral.satellite_thumb_url IS
  'Where satellite_thumb_path was fetched from. Read only by /api/refresh/thumbs, which re-fetches this URL rather than composing one. NULL under the synthetic floor, whose images have no source.';

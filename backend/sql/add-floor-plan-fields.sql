-- Run this once in Supabase SQL Editor.
-- It lets the admin panel save floor plan image and optional animation/embed data.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS floor_plan_url TEXT,
  ADD COLUMN IF NOT EXISTS floor_plan_code TEXT;

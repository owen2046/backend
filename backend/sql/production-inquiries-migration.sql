-- Run once in Neon SQL Editor after the base schema.
-- Keeps the existing inquiries table and adds fields needed to save every frontend enquiry surface.

ALTER TABLE builders
  ADD COLUMN IF NOT EXISTS projects_count INTEGER DEFAULT 0;

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS property_name TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS page_path TEXT,
  ADD COLUMN IF NOT EXISTS request_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status);
CREATE INDEX IF NOT EXISTS idx_inquiries_source ON inquiries (source);
CREATE INDEX IF NOT EXISTS idx_saved_properties_user_id ON saved_properties (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_properties_property_id ON saved_properties (property_id);

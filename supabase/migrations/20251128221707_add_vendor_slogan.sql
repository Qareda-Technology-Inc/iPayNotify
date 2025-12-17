-- Add slogan field to vendors
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS slogan text;

-- RLS remains unchanged
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

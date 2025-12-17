-- Apply vendor settings columns migration
-- Run this SQL in your Supabase SQL Editor if the columns are missing

-- Add vendor settings fields (if they don't exist)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS slogan text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Re-enable RLS (unchanged)
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Allow vendor admins to read their own vendor settings
DROP POLICY IF EXISTS "Admin read own vendor" ON vendors;
CREATE POLICY "Admin read own vendor" ON vendors
  FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendors.id::text
  );

-- Allow vendor admins to update their own vendor details
DROP POLICY IF EXISTS "Admin update own vendor" ON vendors;
CREATE POLICY "Admin update own vendor"
  ON vendors
  FOR UPDATE
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendors.id::text
  )
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendors.id::text
  );

-- Create trigger function to automatically update updated_at (if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at on vendors table
DROP TRIGGER IF EXISTS update_vendors_updated_at ON vendors;
CREATE TRIGGER update_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


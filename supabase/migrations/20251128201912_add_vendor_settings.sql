-- Add vendor settings fields
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Optional: backfill existing vendors with placeholders
UPDATE vendors SET
  address = address,
  contact_email = contact_email,
  contact_phone = contact_phone,
  logo_url = logo_url,
  website = website;

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

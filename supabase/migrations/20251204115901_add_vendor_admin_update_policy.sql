-- Add UPDATE policy for vendor admins to update their own vendor details
-- This allows vendor admins to update company settings from the Company Settings page

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

-- Note: Vendor admins should not need INSERT policy as vendors are created by super admins
-- However, if a vendor record is missing, the super admin should create it


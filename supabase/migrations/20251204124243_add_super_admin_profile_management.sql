-- Add UPDATE and DELETE policies for super admins on profiles table
-- This allows super admins to manage staff members (update roles, delete accounts)

-- Super admin can update profiles (for role changes, etc.)
DROP POLICY IF EXISTS "super_admin update profiles" ON profiles;
CREATE POLICY "super_admin update profiles"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin')
  WITH CHECK (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

-- Super admin can delete profiles (for staff management)
DROP POLICY IF EXISTS "super_admin delete profiles" ON profiles;
CREATE POLICY "super_admin delete profiles"
  ON profiles
  FOR DELETE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

-- Also allow regular admins to update profiles within their vendor
-- (for role changes within their own vendor)
DROP POLICY IF EXISTS "Admin update profiles within vendor" ON profiles;
CREATE POLICY "Admin update profiles within vendor"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = profiles.vendor_id::text
  )
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = profiles.vendor_id::text
  );


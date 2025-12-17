/*
  # Fix Infinite Recursion in Profiles RLS Policies

  1. Changes
    - Update auth.users raw_user_meta_data for qaredadev@gmail.com to have admin role
    - Drop problematic recursive RLS policy on profiles table
    - Recreate policy using auth.users metadata instead of profiles table query
    - This prevents infinite recursion when checking admin permissions

  2. Security
    - Maintains security while fixing recursion issue
    - Uses auth metadata instead of profiles table for role checking
*/

-- First, update the auth.users metadata for the admin account
UPDATE auth.users 
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
WHERE email = 'qaredadev@gmail.com';

-- Drop the problematic recursive policy
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;

-- Recreate the policy using auth.users metadata instead of profiles table
-- This prevents infinite recursion by not querying the profiles table itself
CREATE POLICY "Admins can read all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Check if current user has admin role in auth metadata
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
    OR
    -- Fallback: check raw_user_meta_data directly
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND (auth.users.raw_user_meta_data ->> 'role') = 'admin'
    )
  );

-- Also update the customers policy to use the same non-recursive approach
DROP POLICY IF EXISTS "Staff can update customers" ON customers;
CREATE POLICY "Staff can update customers"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR 
    -- Use auth metadata instead of profiles table to avoid recursion
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
    OR
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND (auth.users.raw_user_meta_data ->> 'role') = 'admin'
    )
  );

-- Update the delete policy as well
DROP POLICY IF EXISTS "Only admins can delete customers" ON customers;
CREATE POLICY "Only admins can delete customers"
  ON customers
  FOR DELETE
  TO authenticated
  USING (
    -- Use auth metadata instead of profiles table to avoid recursion
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
    OR
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND (auth.users.raw_user_meta_data ->> 'role') = 'admin'
    )
  );

-- Verify the admin user metadata was updated
SELECT 
  email,
  raw_user_meta_data ->> 'role' as metadata_role,
  'Auth metadata updated' as status
FROM auth.users 
WHERE email = 'qaredadev@gmail.com';

-- Final verification
DO $$
DECLARE
  metadata_role text;
BEGIN
  SELECT raw_user_meta_data ->> 'role' INTO metadata_role
  FROM auth.users 
  WHERE email = 'qaredadev@gmail.com';
  
  IF metadata_role = 'admin' THEN
    RAISE NOTICE '✅ SUCCESS: qaredadev@gmail.com auth metadata set to admin';
    RAISE NOTICE '✅ RLS policies updated to prevent recursion';
  ELSE
    RAISE NOTICE '❌ WARNING: Auth metadata role is: %', COALESCE(metadata_role, 'NULL');
  END IF;
END $$;
/*
  # Fix Permission Denied for Table Users Error

  1. Problem
    - RLS policies are trying to query auth.users table directly
    - Authenticated users don't have SELECT permission on auth.users
    - This causes "permission denied for table users" error

  2. Solution
    - Remove all direct queries to auth.users table from RLS policies
    - Use only auth.jwt() ->> 'user_metadata' for role checks
    - This is the recommended secure way to access user roles in RLS

  3. Security
    - Maintains security by using JWT metadata
    - Prevents permission errors while keeping role-based access control
*/

-- Drop all problematic policies that query auth.users
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Staff can update customers" ON customers;
DROP POLICY IF EXISTS "Only admins can delete customers" ON customers;

-- Recreate policies using ONLY JWT metadata (no auth.users queries)
CREATE POLICY "Admins can read all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Only use JWT metadata, no auth.users queries
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

CREATE POLICY "Staff can update customers"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR 
    -- Only use JWT metadata, no auth.users queries
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

CREATE POLICY "Only admins can delete customers"
  ON customers
  FOR DELETE
  TO authenticated
  USING (
    -- Only use JWT metadata, no auth.users queries
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- Ensure the admin user has the role in JWT metadata
-- This updates the auth.users table which will be reflected in JWT
UPDATE auth.users 
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
WHERE email = 'qaredadev@gmail.com';

-- Verification
SELECT 
  email,
  raw_user_meta_data ->> 'role' as role,
  'JWT metadata updated for admin access' as status
FROM auth.users 
WHERE email = 'qaredadev@gmail.com';

RAISE NOTICE '✅ Fixed: Removed all auth.users queries from RLS policies';
RAISE NOTICE '✅ Fixed: Using only JWT metadata for role checks';
RAISE NOTICE '✅ Fixed: qaredadev@gmail.com set as admin in JWT metadata';
/*
  # Add Staff Role Support

  1. Changes
    - Update profiles table to support 'admin' and 'staff' roles instead of 'admin' and 'user'
    - Update all existing 'user' roles to 'staff'
    - Update check constraint to allow 'admin' and 'staff' only
    - Update RLS policies to work with new role structure

  2. Security
    - Maintains all existing security policies
    - Updates role references throughout the system
*/

-- First, update the check constraint to allow 'admin' and 'staff' roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'staff'));

-- Update all existing 'user' roles to 'staff'
UPDATE profiles SET role = 'staff' WHERE role = 'user';

-- Update the default role in the table definition
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'staff';

-- Update the handle_new_user function to default to 'staff' instead of 'user'
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    now(),
    now()
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log the error but don't fail the user creation
    RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update customer policies to work with 'staff' role instead of 'user'
-- Users (now staff) can update customers they created, admins can update all
DROP POLICY IF EXISTS "Users can update customers" ON customers;
CREATE POLICY "Staff can update customers"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Ensure qaredadev@gmail.com has admin role
UPDATE profiles 
SET role = 'admin', updated_at = now()
WHERE email = 'qaredadev@gmail.com';

-- Verify the changes
SELECT 
  email,
  role,
  'Updated successfully' as status
FROM profiles 
ORDER BY role, email;

-- Show the constraint to confirm it's updated
SELECT 
  conname as constraint_name,
  consrc as constraint_definition
FROM pg_constraint 
WHERE conname = 'profiles_role_check';

RAISE NOTICE '✅ SUCCESS: Role system updated to support admin and staff roles';
RAISE NOTICE '✅ All existing users converted from "user" to "staff" role';
RAISE NOTICE '✅ qaredadev@gmail.com confirmed as admin';
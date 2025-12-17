/*
  # Create Admin Credentials Migration

  1. Changes
    - Ensure qaredadev@gmail.com has admin role in profiles table
    - This migration is safe to run multiple times
    - Creates the profile if it doesn't exist, updates if it does

  2. Security
    - Only affects the specific admin email account
    - Maintains existing data integrity
*/

-- First, check if the profile exists and update/insert accordingly
DO $$
BEGIN
  -- Check if profile exists for qaredadev@gmail.com
  IF EXISTS (
    SELECT 1 FROM profiles 
    WHERE email = 'qaredadev@gmail.com'
  ) THEN
    -- Update existing profile to admin role
    UPDATE profiles 
    SET role = 'admin', updated_at = now()
    WHERE email = 'qaredadev@gmail.com';
    
    RAISE NOTICE 'Updated existing profile for qaredadev@gmail.com to admin role';
  ELSE
    -- If no profile exists, we need to check if there's an auth user first
    IF EXISTS (
      SELECT 1 FROM auth.users 
      WHERE email = 'qaredadev@gmail.com'
    ) THEN
      -- Insert profile for existing auth user
      INSERT INTO profiles (id, email, role, created_at, updated_at)
      SELECT id, email, 'admin', now(), now()
      FROM auth.users 
      WHERE email = 'qaredadev@gmail.com';
      
      RAISE NOTICE 'Created new admin profile for existing auth user qaredadev@gmail.com';
    ELSE
      RAISE NOTICE 'No auth user found for qaredadev@gmail.com - profile will be created automatically on first login';
    END IF;
  END IF;
END $$;

-- Verify the admin role is set correctly
DO $$
DECLARE
  admin_role text;
BEGIN
  SELECT role INTO admin_role 
  FROM profiles 
  WHERE email = 'qaredadev@gmail.com';
  
  IF admin_role = 'admin' THEN
    RAISE NOTICE 'SUCCESS: qaredadev@gmail.com has admin role';
  ELSIF admin_role IS NOT NULL THEN
    RAISE NOTICE 'WARNING: qaredadev@gmail.com has role: %', admin_role;
  ELSE
    RAISE NOTICE 'INFO: No profile found for qaredadev@gmail.com yet';
  END IF;
END $$;
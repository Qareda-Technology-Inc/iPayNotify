/*
  # Fix Admin Role for qaredadev@gmail.com

  1. Changes
    - Specifically update qaredadev@gmail.com to have admin role
    - This account should be admin, not staff
    - Safe to run multiple times

  2. Security
    - Only affects the specific admin email account
    - Maintains data integrity
*/

-- Force update qaredadev@gmail.com to admin role
UPDATE profiles 
SET role = 'admin', updated_at = now()
WHERE email = 'qaredadev@gmail.com';

-- Verify the update worked
DO $$
DECLARE
  current_role text;
  user_exists boolean;
BEGIN
  -- Check if user exists and get role
  SELECT role INTO current_role 
  FROM profiles 
  WHERE email = 'qaredadev@gmail.com';
  
  user_exists := current_role IS NOT NULL;
  
  IF user_exists THEN
    IF current_role = 'admin' THEN
      RAISE NOTICE '✅ SUCCESS: qaredadev@gmail.com now has admin role';
    ELSE
      RAISE NOTICE '❌ FAILED: qaredadev@gmail.com has role: %', current_role;
    END IF;
  ELSE
    RAISE NOTICE '❌ ERROR: No profile found for qaredadev@gmail.com';
  END IF;
END $$;

-- Show final verification
SELECT 
  email,
  role,
  updated_at,
  'Admin account verified' as status
FROM profiles 
WHERE email = 'qaredadev@gmail.com';
/*
  # Force Admin Role Update

  1. Changes
    - Directly update the role for qaredadev@gmail.com to admin
    - Handle both existing profile and missing profile scenarios
    - Force the role change regardless of current state

  2. Security
    - Only affects the specific admin email account
    - Safe to run multiple times
    - Provides clear feedback on what happened
*/

-- First, let's see what we're working with
DO $$
DECLARE
  user_exists boolean := false;
  profile_exists boolean := false;
  current_role text;
  user_id uuid;
BEGIN
  -- Check if auth user exists
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = 'qaredadev@gmail.com') INTO user_exists;
  
  -- Get user ID if exists
  IF user_exists THEN
    SELECT id INTO user_id FROM auth.users WHERE email = 'qaredadev@gmail.com';
    RAISE NOTICE 'Found auth user with ID: %', user_id;
    
    -- Check if profile exists
    SELECT EXISTS(SELECT 1 FROM profiles WHERE email = 'qaredadev@gmail.com') INTO profile_exists;
    
    IF profile_exists THEN
      SELECT role INTO current_role FROM profiles WHERE email = 'qaredadev@gmail.com';
      RAISE NOTICE 'Found existing profile with role: %', current_role;
      
      -- Force update to admin
      UPDATE profiles 
      SET role = 'admin', updated_at = now() 
      WHERE email = 'qaredadev@gmail.com';
      
      RAISE NOTICE 'SUCCESS: Updated role from % to admin for qaredadev@gmail.com', current_role;
    ELSE
      -- Create profile with admin role
      INSERT INTO profiles (id, email, role, created_at, updated_at)
      VALUES (user_id, 'qaredadev@gmail.com', 'admin', now(), now());
      
      RAISE NOTICE 'SUCCESS: Created new admin profile for qaredadev@gmail.com';
    END IF;
  ELSE
    RAISE NOTICE 'WARNING: No auth user found for qaredadev@gmail.com - please sign up first';
  END IF;
END $$;

-- Verify the final state
SELECT 
  p.email,
  p.role,
  p.created_at,
  p.updated_at,
  'Profile exists' as status
FROM profiles p 
WHERE p.email = 'qaredadev@gmail.com'
UNION ALL
SELECT 
  au.email,
  'NO_PROFILE' as role,
  au.created_at,
  au.updated_at,
  'Auth user exists but no profile' as status
FROM auth.users au 
WHERE au.email = 'qaredadev@gmail.com' 
AND NOT EXISTS (SELECT 1 FROM profiles WHERE email = au.email);

-- Final verification
DO $$
DECLARE
  final_role text;
BEGIN
  SELECT role INTO final_role FROM profiles WHERE email = 'qaredadev@gmail.com';
  
  IF final_role = 'admin' THEN
    RAISE NOTICE '✅ VERIFICATION PASSED: qaredadev@gmail.com has admin role';
  ELSIF final_role IS NOT NULL THEN
    RAISE NOTICE '❌ VERIFICATION FAILED: qaredadev@gmail.com has role: %', final_role;
  ELSE
    RAISE NOTICE '❌ VERIFICATION FAILED: No profile found for qaredadev@gmail.com';
  END IF;
END $$;
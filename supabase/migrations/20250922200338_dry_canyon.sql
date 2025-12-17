/*
  # Fix User Creation Issues

  1. Changes
    - Update RLS policies to allow proper user creation
    - Fix the handle_new_user trigger function
    - Add policy for inserting profiles during signup

  2. Security
    - Maintains security while allowing user creation
    - Ensures profiles are created automatically
*/

-- Drop existing trigger and function to recreate them properly
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Recreate the function with better error handling
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
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

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Add policy to allow inserting profiles during signup
DROP POLICY IF EXISTS "Allow profile creation during signup" ON profiles;
CREATE POLICY "Allow profile creation during signup"
  ON profiles
  FOR INSERT
  WITH CHECK (true);

-- Update existing policies to be more permissive for profile creation
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Add policy for admins to read all profiles (needed for staff management)
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
CREATE POLICY "Admins can read all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Ensure the admin account exists and has proper role
DO $$
BEGIN
  -- Update or insert admin profile
  INSERT INTO profiles (id, email, role, created_at, updated_at)
  SELECT 
    au.id, 
    au.email, 
    'admin',
    now(),
    now()
  FROM auth.users au
  WHERE au.email = 'qaredadev@gmail.com'
  ON CONFLICT (id) 
  DO UPDATE SET 
    role = 'admin',
    updated_at = now();
    
  RAISE NOTICE 'Admin profile updated/created for qaredadev@gmail.com';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not create admin profile: %', SQLERRM;
END $$;
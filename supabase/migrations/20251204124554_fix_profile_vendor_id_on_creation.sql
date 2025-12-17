-- Fix handle_new_user trigger to include vendor_id when creating profiles
-- This ensures that when staff are created, their vendor_id is properly set

-- Update the handle_new_user function to extract vendor_id from raw_user_meta_data
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, vendor_id, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    -- Extract vendor_id from raw_user_meta_data, convert to uuid if present
    CASE 
      WHEN NEW.raw_user_meta_data->>'vendor_id' IS NOT NULL 
      THEN (NEW.raw_user_meta_data->>'vendor_id')::uuid
      ELSE NULL
    END,
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


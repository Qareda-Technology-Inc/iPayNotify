/*
  # Set admin role for qaredadev@gmail.com

  1. Changes
    - Update the profile for qaredadev@gmail.com to have admin role
    - This will give the account access to admin features like adding staff

  2. Notes
    - This migration specifically targets the qaredadev@gmail.com account
    - Safe to run multiple times (uses WHERE clause)
*/

-- Update the role for qaredadev@gmail.com to admin
UPDATE profiles 
SET role = 'admin' 
WHERE email = 'qaredadev@gmail.com';

-- Verify the update (this will show in the query results)
SELECT email, role 
FROM profiles 
WHERE email = 'qaredadev@gmail.com';
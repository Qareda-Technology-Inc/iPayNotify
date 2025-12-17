/*
  # Remove email column from customers table

  1. Changes
    - Remove `email` column from `customers` table
    - This aligns with the frontend form that no longer collects email addresses

  2. Notes
    - This is a safe operation as email was optional (nullable)
    - No data loss concerns since email field is not being used
*/

-- Remove email column from customers table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'email'
  ) THEN
    ALTER TABLE customers DROP COLUMN email;
  END IF;
END $$;
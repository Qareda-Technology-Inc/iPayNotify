/*
  # Multivendor Enablement

  1. New Tables
    - vendors
      - id uuid primary key
      - name text
      - created_at timestamptz

  2. Schema Changes
    - profiles: add vendor_id -> vendors(id)
    - customers: add vendor_id -> vendors(id) NOT NULL
    - payments: add vendor_id -> vendors(id) NOT NULL

  3. RLS Updates
    - Scope all CRUD by vendor_id using auth.jwt()->>'user_metadata'->'vendor_id'
    - Keep role-based rules (admin vs staff) within a vendor

  4. Data Migration
    - Create a default vendor and assign existing data to it
*/

-- 1) Create vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2) Add vendor_id columns
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id);
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id);
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id);

-- 3) Create a default vendor and link existing data
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Create default vendor
  INSERT INTO vendors (name) VALUES ('Qaretech Innovative')
  RETURNING id INTO v_id;

  -- Set vendor for profiles: admin profile if exists gets this vendor
  UPDATE profiles SET vendor_id = v_id WHERE vendor_id IS NULL;

  -- Set vendor for customers and payments
  UPDATE customers SET vendor_id = v_id WHERE vendor_id IS NULL;
  UPDATE payments SET vendor_id = v_id WHERE vendor_id IS NULL;
END $$;

-- Enforce NOT NULL on tenant columns after backfill
ALTER TABLE customers ALTER COLUMN vendor_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN vendor_id SET NOT NULL;

-- 4) RLS: Drop existing policies that don't consider vendor
DO $$
BEGIN
  -- customers
  DROP POLICY IF EXISTS "Authenticated users can read customers" ON customers;
  DROP POLICY IF EXISTS "Authenticated users can insert customers" ON customers;
  DROP POLICY IF EXISTS "Users can update customers" ON customers;
  DROP POLICY IF EXISTS "Only admins can delete customers" ON customers;
  -- payments
  DROP POLICY IF EXISTS "Authenticated users can read payments" ON payments;
  DROP POLICY IF EXISTS "Authenticated users can insert payments" ON payments;
  DROP POLICY IF EXISTS "Staff can update payments" ON payments;
  DROP POLICY IF EXISTS "Only admins can delete payments" ON payments;
  -- profiles (admin read policy may exist)
  DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
EXCEPTION WHEN others THEN
  -- ignore missing
  NULL;
END $$;

-- Helper: Current vendor from JWT metadata
-- We cannot create SQL function that reads JWT in PostgREST context easily here; use inline expressions.

-- 5) Recreate vendor-scoped policies

-- customers: SELECT within same vendor
CREATE POLICY "Read customers within vendor"
  ON customers
  FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = customers.vendor_id::text
  );

-- customers: INSERT only within same vendor
CREATE POLICY "Insert customers within vendor"
  ON customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendor_id::text
    AND created_by = auth.uid()
  );

-- customers: UPDATE own or admin, within vendor
CREATE POLICY "Update customers within vendor"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (
    (
      created_by = auth.uid()
      OR ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    )
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = customers.vendor_id::text
  )
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendor_id::text
  );

-- customers: DELETE admin only, within vendor
CREATE POLICY "Delete customers within vendor (admin)"
  ON customers
  FOR DELETE
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = customers.vendor_id::text
  );

-- payments: SELECT within vendor
CREATE POLICY "Read payments within vendor"
  ON payments
  FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = payments.vendor_id::text
  );

-- payments: INSERT within vendor
CREATE POLICY "Insert payments within vendor"
  ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendor_id::text
    AND created_by = auth.uid()
  );

-- payments: UPDATE own or admin within vendor
CREATE POLICY "Update payments within vendor"
  ON payments
  FOR UPDATE
  TO authenticated
  USING (
    (
      created_by = auth.uid()
      OR ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    )
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = payments.vendor_id::text
  )
  WITH CHECK (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = vendor_id::text
  );

-- payments: DELETE admin within vendor
CREATE POLICY "Delete payments within vendor (admin)"
  ON payments
  FOR DELETE
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = payments.vendor_id::text
  );

-- profiles: admins can read profiles within same vendor
CREATE POLICY "Admins read profiles within vendor"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'admin'
    AND ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'vendor_id') = profiles.vendor_id::text
  );

-- Ensure JWT metadata contains vendor_id for known admin
UPDATE auth.users 
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('vendor_id', (SELECT id::text FROM vendors ORDER BY created_at LIMIT 1))
WHERE email = 'qaredadev@gmail.com';



/*
  # Super Admin Permissions

  - Allow role 'super_admin' (from JWT metadata) to manage vendors and access data across vendors.

  1) Enable RLS on vendors and add policies for super_admin
  2) Add permissive policies for customers/payments/profiles for super_admin
*/

-- Ensure RLS on vendors
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Vendors policies
DROP POLICY IF EXISTS "super_admin read vendors" ON vendors;
CREATE POLICY "super_admin read vendors"
  ON vendors
  FOR SELECT
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "super_admin insert vendors" ON vendors;
CREATE POLICY "super_admin insert vendors"
  ON vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "super_admin update vendors" ON vendors;
CREATE POLICY "super_admin update vendors"
  ON vendors
  FOR UPDATE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin')
  WITH CHECK (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "super_admin delete vendors" ON vendors;
CREATE POLICY "super_admin delete vendors"
  ON vendors
  FOR DELETE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

-- Customers super_admin access
DROP POLICY IF EXISTS "super_admin read customers" ON customers;
CREATE POLICY "super_admin read customers"
  ON customers
  FOR SELECT
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "super_admin update customers" ON customers;
CREATE POLICY "super_admin update customers"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin')
  WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin delete customers" ON customers;
CREATE POLICY "super_admin delete customers"
  ON customers
  FOR DELETE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

-- Payments super_admin access
DROP POLICY IF EXISTS "super_admin read payments" ON payments;
CREATE POLICY "super_admin read payments"
  ON payments
  FOR SELECT
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "super_admin update payments" ON payments;
CREATE POLICY "super_admin update payments"
  ON payments
  FOR UPDATE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin')
  WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin delete payments" ON payments;
CREATE POLICY "super_admin delete payments"
  ON payments
  FOR DELETE
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');

-- Profiles super_admin read across vendors
DROP POLICY IF EXISTS "super_admin read profiles" ON profiles;
CREATE POLICY "super_admin read profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role') = 'super_admin');



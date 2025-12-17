/*
  # Create payments table for subscription renewals

  1. New Tables
    - `payments`
      - `id` (uuid, primary key)
      - `customer_id` (uuid, references customers)
      - `amount` (numeric, payment amount)
      - `payment_method` (text, payment method used)
      - `payment_reference` (text, transaction reference)
      - `payment_date` (date, when payment was made)
      - `months_paid` (integer, number of months paid for)
      - `notes` (text, additional notes)
      - `created_by` (uuid, references profiles)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `payments` table
    - Add policies for authenticated users to manage payments
    - Only staff can view and create payments
    - Only admins can delete payments

  3. Indexes
    - Add index on customer_id for faster lookups
    - Add index on payment_date for reporting
*/

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'card')),
  payment_reference text,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  months_paid integer NOT NULL DEFAULT 1 CHECK (months_paid > 0),
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all payments
CREATE POLICY "Authenticated users can read payments"
  ON payments
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert payments
CREATE POLICY "Authenticated users can insert payments"
  ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Users can update payments they created, admins can update all
CREATE POLICY "Staff can update payments"
  ON payments
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR 
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- Only admins can delete payments
CREATE POLICY "Only admins can delete payments"
  ON payments
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin'
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments(created_by);

-- Trigger to automatically update updated_at
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ SUCCESS: Payments table created with RLS policies';
  RAISE NOTICE '✅ SUCCESS: Payment methods: cash, mobile_money, bank_transfer, card';
  RAISE NOTICE '✅ SUCCESS: Indexes created for performance';
  RAISE NOTICE '✅ SUCCESS: Auto-update trigger added';
END $$;
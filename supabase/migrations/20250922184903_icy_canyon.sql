/*
  # Create customers table for subscription management

  1. New Tables
    - `customers`
      - `id` (uuid, primary key)
      - `name` (text, customer name)
      - `phone` (text, phone number)
      - `email` (text, optional email)
      - `subscription_type` (text, subscription plan)
      - `monthly_fee` (numeric, monthly cost)
      - `subscription_date` (date, when subscription started)
      - `expiry_date` (date, when subscription expires)
      - `is_active` (boolean, subscription status)
      - `last_reminder_sent` (timestamptz, last SMS reminder)
      - `notes` (text, additional notes)
      - `created_by` (uuid, references profiles)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `customers` table
    - Add policies for authenticated users to manage customers
*/

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  subscription_type text NOT NULL DEFAULT 'Basic' CHECK (subscription_type IN ('Basic', 'Standard', 'Premium', 'Enterprise')),
  monthly_fee numeric(10,2) NOT NULL DEFAULT 0,
  subscription_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_reminder_sent timestamptz,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all customers
CREATE POLICY "Authenticated users can read customers"
  ON customers
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert customers
CREATE POLICY "Authenticated users can insert customers"
  ON customers
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Users can update customers they created, admins can update all
CREATE POLICY "Users can update customers"
  ON customers
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete customers
CREATE POLICY "Only admins can delete customers"
  ON customers
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
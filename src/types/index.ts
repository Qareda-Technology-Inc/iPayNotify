export interface Customer {
  id?: string
  name: string
  phone: string
  subscription_type: 'Basic' | 'Standard' | 'Premium' | 'Enterprise'
  monthly_fee: number
  subscription_date: string
  expiry_date: string
  is_active: boolean
  last_reminder_sent?: string
  notes?: string
  created_at?: string
  updated_at?: string
  vendor_id?: string
}

export interface DashboardStats {
  totalCustomers: number
  activeCustomers: number
  expiredCustomers: number
  expiringSoonCustomers: number
  monthlyRevenue: number
}

export interface Payment {
  id?: string
  customer_id: string
  amount: number
  payment_method: 'cash' | 'mobile_money' | 'bank_transfer' | 'card'
  payment_reference?: string
  payment_date: string
  months_paid: number
  notes?: string
  created_by: string
  created_at?: string
  updated_at?: string
  vendor_id?: string
}

export interface PaymentSummary {
  customer: Customer
  totalPaid: number
  lastPayment?: Payment
  monthsRemaining: number
}

export interface Vendor {
  id: string;
  name: string;
  created_at?: string;
  address?: string;
  contact_email?: string;
  contact_phone?: string;
  logo_url?: string;
  website?: string;
  slogan?: string;
}
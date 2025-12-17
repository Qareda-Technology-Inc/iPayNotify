import React, { useState, useEffect } from 'react';
import { Customer, DashboardStats } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useVendor } from '../hooks/useVendor';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../lib/smsService';
import { CustomerModal } from './CustomerModal';
import { SMSModal } from './SMSModal';
import { StaffModal } from './StaffModal';
import { PaymentModal } from './PaymentModal';
import { templateExpiring, templateExpired } from '../lib/messageTemplates';
import { VendorModal } from './VendorModal';
import { VendorListModal } from './VendorListModal';
import { VendorSettingsModal } from './VendorSettingsModal';
import { VendorManagement } from './VendorManagement';
import { StaffManagement } from './StaffManagement';

export const Dashboard: React.FC = () => {
  const [showVendorManagement, setShowVendorManagement] = useState(false);
  const [showStaffManagement, setShowStaffManagement] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    activeCustomers: 0,
    expiredCustomers: 0,
    expiringSoonCustomers: 0,
    monthlyRevenue: 0
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showVendorList, setShowVendorList] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | undefined>();
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | undefined>();
  const [sendingSMS, setSendingSMS] = useState<string | null>(null);
  const [showVendorSettings, setShowVendorSettings] = useState(false);
  const { logout, user, refreshUserProfile } = useAuth();
  const { vendor } = useVendor();
  // Revenue range (admin can modify)
  const formatYmd = (d: Date) => d.toISOString().split('T')[0];
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const [revenueStart, setRevenueStart] = useState<string>(formatYmd(defaultStart));
  const [revenueEnd, setRevenueEnd] = useState<string>(formatYmd(defaultEnd));

  useEffect(() => {
    fetchCustomers();
    // Force refresh user profile when dashboard loads
    refreshUserProfile();
  }, []);
  // Recompute revenue whenever the date range changes
  useEffect(() => {
    fetchRevenueForRange(revenueStart, revenueEnd);
  }, [revenueStart, revenueEnd]);

  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      const { data: customerList, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customers:', error);
        return;
      }

      // Calculate stats
      const now = new Date();
      const activeCustomers = customerList?.filter((c: Customer) => 
        c.is_active && new Date(c.expiry_date) > now
      ) || [];
      
      const expiredCustomers = customerList?.filter((c: Customer) => 
        new Date(c.expiry_date) <= now
      ) || [];
      
      const expiringSoonCustomers = customerList?.filter((c: Customer) => {
        const expiry = new Date(c.expiry_date);
        const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil <= 3 && daysUntil > 0;
      }) || [];
      
      setStats({
        totalCustomers: customerList?.length || 0,
        activeCustomers: activeCustomers.length,
        expiredCustomers: expiredCustomers.length,
        expiringSoonCustomers: expiringSoonCustomers.length,
        monthlyRevenue: stats.monthlyRevenue
      });

      setCustomers(customerList || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setIsLoading(false);
    }
  };
  const fetchRevenueForRange = async (startStr: string, endStr: string) => {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('amount, payment_date')
        .gte('payment_date', startStr)
        .lt('payment_date', endStr);

      if (error) {
        console.error('Error fetching monthly revenue:', error);
        return;
      }

      const monthlyRevenue = (data || []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

      setStats((prev) => ({
        ...prev,
        monthlyRevenue
      }));
    } catch (e) {
      console.error('Error computing monthly revenue:', e);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!confirm('Are you sure you want to delete this customer? This action cannot be undone.')) return;

    try {
      setIsLoading(true);
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (error) {
        console.error('Error deleting customer:', error);
        alert(`Failed to delete customer: ${error.message}`);
        return;
      }

      // Show success message
      alert('Customer deleted successfully!');
      await fetchCustomers();
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert(`Failed to delete customer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSMSReminder = async (customer: Customer) => {
    setSendingSMS(customer.id!);
    
    try {
      const now = new Date();
      const expiry = new Date(customer.expiry_date);
      const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      
      let message = '';
      if (daysUntil < 0) {
        message = templateExpired(customer.name, Math.abs(daysUntil), expiry, vendorData);
      } else if (daysUntil <= 7) {
        message = templateExpiring(customer.name, daysUntil, expiry, vendorData);
      } else {
        // Treat as gentle reminder with days left
        message = templateExpiring(customer.name, daysUntil, expiry, vendorData);
      }
      
      await sendSMS(customer.phone, message, vendor?.name);
      
      // Update last_reminder_sent
      await supabase
        .from('customers')
        .update({ last_reminder_sent: new Date().toISOString() })
        .eq('id', customer.id);
      
      alert(`SMS reminder sent successfully to ${customer.name}!`);
      await fetchCustomers(); // Refresh to update last_reminder_sent
      
    } catch (error) {
      console.error('Error sending SMS reminder:', error);
      alert(`Failed to send SMS to ${customer.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingSMS(null);
    }
  };

  const getSubscriptionStatus = (expiryDate: string | Date) => {
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      return { status: 'Expired', color: 'bg-red-100 text-red-800', days: Math.abs(daysUntil) };
    } else if (daysUntil <= 3) {
      return { status: 'Expiring Soon', color: 'bg-yellow-100 text-yellow-800', days: daysUntil };
    } else {
      return { status: 'Active', color: 'bg-green-100 text-green-800', days: daysUntil };
    }
  };

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone.includes(searchTerm)
  );

  // Show Vendor Management page if requested
  if (showVendorManagement) {
    return <VendorManagement onBack={() => setShowVendorManagement(false)} />;
  }

  // Show Staff Management page if requested
  if (showStaffManagement) {
    return <StaffManagement onBack={() => setShowStaffManagement(false)} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 min-h-[4rem]">
            <div className="flex items-center space-x-2 sm:space-x-3">
              {vendor?.logo_url ? (
                <img 
                  src={vendor.logo_url} 
                  alt={vendor.name || 'Company Logo'} 
                  className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg object-cover"
                />
              ) : (
                <div className="bg-blue-600 p-2 rounded-lg">
                  <span className="text-white text-lg sm:text-xl">📡</span>
                </div>
              )}
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">
                  {vendor?.name || 'Qaretech Innovative'}
                </h1>
                <p className="text-xs sm:text-sm text-gray-600 hidden sm:block">
                  {vendor?.slogan || 'Subscription Management'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              <div className="text-right hidden sm:block">
                <p className="text-xs sm:text-sm font-medium text-gray-900">{user?.email}</p>
                <p className="text-xs text-gray-600 capitalize">
                  {user?.role} 
                  <button 
                    onClick={refreshUserProfile}
                    className="ml-2 text-blue-500 hover:text-blue-700"
                    title="Refresh role"
                  >
                    🔄
                  </button>
                </p>
              </div>
              <div className="sm:hidden">
                <p className="text-xs font-medium text-gray-900 capitalize">
                  {user?.role}
                </p>
              </div>
              <button 
                onClick={logout}
                className="flex items-center space-x-2 text-gray-600 hover:text-red-600 transition-colors duration-200"
              >
                <span>🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Super Admin Controls */}
        {user?.role === 'super_admin' && (
          <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100 mb-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Super Admin Controls</p>
              <button
                onClick={() => setShowVendorModal(true)}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Create Vendor
              </button>
            </div>
          </div>
        )}

        {/* Admin Revenue Controls */}
        {user?.role === 'admin' && (
          <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Revenue Date Range</p>
                <div className="mt-2 flex items-center gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Start</label>
                    <input
                      type="date"
                      value={revenueStart}
                      max={revenueEnd}
                      onChange={(e) => setRevenueStart(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">End</label>
                    <input
                      type="date"
                      value={revenueEnd}
                      min={revenueStart}
                      onChange={(e) => setRevenueEnd(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const t = new Date();
                    const s = new Date(t.getFullYear(), t.getMonth(), 1);
                    const e = new Date(t.getFullYear(), t.getMonth() + 1, 1);
                    setRevenueStart(formatYmd(s));
                    setRevenueEnd(formatYmd(e));
                  }}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                >
                  This Month
                </button>
                <button
                  onClick={() => {
                    const e = new Date();
                    const s = new Date();
                    s.setDate(e.getDate() - 7);
                    setRevenueStart(formatYmd(s));
                    setRevenueEnd(formatYmd(e));
                  }}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                >
                  Last 7 Days
                </button>
                <button
                  onClick={() => {
                    const e = new Date();
                    const s = new Date();
                    s.setDate(e.getDate() - 30);
                    setRevenueStart(formatYmd(s));
                    setRevenueEnd(formatYmd(e));
                  }}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                >
                  Last 30 Days
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium">Total</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-900">{stats.totalCustomers}</p>
              </div>
              <div className="bg-blue-100 p-2 sm:p-3 rounded-lg">
                <span className="text-lg sm:text-2xl">👥</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium">Active</p>
                <p className="text-lg sm:text-2xl font-bold text-green-600">{stats.activeCustomers}</p>
              </div>
              <div className="bg-green-100 p-2 sm:p-3 rounded-lg">
                <span className="text-lg sm:text-2xl">✅</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium">Expiring</p>
                <p className="text-lg sm:text-2xl font-bold text-yellow-600">{stats.expiringSoonCustomers}</p>
              </div>
              <div className="bg-yellow-100 p-2 sm:p-3 rounded-lg">
                <span className="text-lg sm:text-2xl">⚠️</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium">Expired</p>
                <p className="text-lg sm:text-2xl font-bold text-red-600">{stats.expiredCustomers}</p>
              </div>
              <div className="bg-red-100 p-2 sm:p-3 rounded-lg">
                <span className="text-lg sm:text-2xl">❌</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-xs sm:text-sm font-medium">Revenue</p>
                <p className="text-lg sm:text-2xl font-bold text-purple-600">GHC {stats.monthlyRevenue.toFixed(2)}</p>
                {(user?.role === 'admin') && (
                  <p className="text-xs text-gray-500 mt-1">{revenueStart} → {revenueEnd}</p>
                )}
              </div>
              <div className="bg-purple-100 p-2 sm:p-3 rounded-lg">
                <span className="text-lg sm:text-2xl">💰</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6 sm:mb-8">
          <button 
            onClick={() => {
              setEditingCustomer(undefined);
              setShowCustomerModal(true);
            }}
            className="flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium text-sm sm:text-base"
          >
            <span>➕</span>
            <span className="hidden sm:inline">Add Customer</span>
            <span className="sm:hidden">Add</span>
          </button>
          
          <button 
            onClick={() => setShowSMSModal(true)}
            className="flex items-center justify-center space-x-2 bg-green-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-green-700 transition-colors duration-200 font-medium text-sm sm:text-base"
          >
            <span>💬</span>
            <span className="hidden sm:inline">Send SMS</span>
            <span className="sm:hidden">SMS</span>
          </button>
          
          {(user?.role === 'admin' || user?.role === 'super_admin') && (
            <>
              <button 
                onClick={() => setShowStaffModal(true)}
                className="flex items-center justify-center space-x-2 bg-purple-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-purple-700 transition-colors duration-200 font-medium text-sm sm:text-base"
              >
               <span>👤➕</span>
                <span className="hidden sm:inline">Add Staff</span>
                <span className="sm:hidden">Staff</span>
              </button>
              <button 
                onClick={() => setShowStaffManagement(true)}
                className="flex items-center justify-center space-x-2 bg-indigo-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-indigo-700 transition-colors duration-200 font-medium text-sm sm:text-base"
              >
               <span>👥</span>
                <span className="hidden sm:inline">Manage Staff</span>
                <span className="sm:hidden">Staff</span>
              </button>
            </>
          )}

          {user?.role === 'super_admin' && (
            <button
              onClick={() => setShowVendorManagement(true)}
              className="mr-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
            >
              Manage Vendors
            </button>
          )}

          {user?.role === 'admin' && (
            <button
              onClick={() => setShowVendorSettings(true)}
              className="mr-2 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
            >
              Company Settings
            </button>
          )}

          <div className="flex-1 sm:max-w-md">
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="text"
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 sm:py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-sm sm:text-base"
              />
            </div>
          </div>
        </div>

        {/* Customers List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 sm:p-6 border-b border-gray-100">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Customers</h2>
          </div>
          
          <div className="p-4 sm:p-6">
            {filteredCustomers.length > 0 ? (
              <div className="space-y-3 sm:space-y-4">
                {filteredCustomers.map((customer) => {
                  const statusInfo = getSubscriptionStatus(customer.expiry_date);
                  return (
                    <div key={customer.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors duration-150 space-y-3 sm:space-y-0">
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-600 font-medium text-xs sm:text-sm">
                            {customer.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-gray-900 text-sm sm:text-base truncate">{customer.name}</h4>
                          <p className="text-xs sm:text-sm text-gray-600">{customer.phone}</p>
                          <p className="text-xs sm:text-sm text-gray-500">{customer.subscription_type} - GHC {customer.monthly_fee}/month</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between sm:justify-end space-x-3 sm:space-x-4">
                        <div className="text-left sm:text-right">
                          <span className={`px-2 sm:px-3 py-1 text-xs font-medium rounded-full ${statusInfo.color}`}>
                            {statusInfo.status}
                          </span>
                          <p className="text-xs sm:text-sm text-gray-600 mt-1">
                            {statusInfo.status === 'Expired' 
                              ? `${statusInfo.days} days ago`
                              : `${statusInfo.days} days left`
                            }
                          </p>
                        </div>
                        
                        <div className="flex space-x-1 sm:space-x-2">
                          <button
                            onClick={() => {
                              setPaymentCustomer(customer);
                              setShowPaymentModal(true);
                            }}
                            className="p-1.5 sm:p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors duration-200"
                            title="Process payment"
                          >
                            <span className="text-sm sm:text-base">💳</span>
                          </button>
                          
                          <button
                            onClick={() => handleQuickSMSReminder(customer)}
                            disabled={sendingSMS === customer.id}
                            className={`p-1.5 sm:p-2 rounded-lg transition-colors duration-200 ${
                              sendingSMS === customer.id
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : statusInfo.status === 'Expired'
                                ? 'text-red-600 hover:bg-red-50'
                                : statusInfo.status === 'Expiring Soon'
                                ? 'text-yellow-600 hover:bg-yellow-50'
                                : 'text-green-600 hover:bg-green-50'
                            }`}
                            title={`Send ${
                              statusInfo.status === 'Expired' ? 'expiry notice' :
                              statusInfo.status === 'Expiring Soon' ? 'renewal reminder' :
                              'subscription reminder'
                            } to ${customer.name}`}
                          >
                            {sendingSMS === customer.id ? (
                              <span className="animate-spin text-sm sm:text-base">⏳</span>
                            ) : (
                              <span className="text-sm sm:text-base">🔔</span>
                            )}
                          </button>
                          
                          <button
                            onClick={() => {
                              setEditingCustomer(customer);
                              setShowCustomerModal(true);
                            }}
                            disabled={isLoading}
                            className="p-1.5 sm:p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Edit customer"
                          >
                            <span className="text-sm sm:text-base">✏️</span>
                          </button>
                          
                          {(user?.role === 'admin' || user?.role === 'super_admin') && (
                            <button
                              onClick={() => handleDeleteCustomer(customer.id!)}
                              className="p-1.5 sm:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                              title="Delete customer"
                            >
                              <span className="text-sm sm:text-base">🗑️</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <span className="text-4xl sm:text-6xl text-gray-300 block mb-4">👥</span>
                <p className="text-gray-500">No customers found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCustomerModal && (
        <CustomerModal 
          customer={editingCustomer}
          onClose={() => {
            setShowCustomerModal(false);
            setEditingCustomer(undefined);
          }}
          onSave={fetchCustomers}
        />
      )}
      
      {showSMSModal && (
        <SMSModal onClose={() => setShowSMSModal(false)} />
      )}
      
      {showStaffModal && (
        <StaffModal onClose={() => setShowStaffModal(false)} />
      )}
      
      {showPaymentModal && paymentCustomer && (
        <PaymentModal 
          customer={paymentCustomer}
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentCustomer(undefined);
          }}
          onSave={fetchCustomers}
        />
      )}

      {showVendorModal && user?.role === 'super_admin' && (
        <VendorModal
          onClose={() => setShowVendorModal(false)}
          onCreated={fetchCustomers}
        />
      )}

      {showVendorList && (
        <VendorListModal onClose={() => setShowVendorList(false)} />
      )}

      {showVendorSettings && (
        <VendorSettingsModal onClose={() => setShowVendorSettings(false)} />
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between space-y-2 sm:space-y-0">
            <p className="text-sm text-gray-600">
              © {new Date().getFullYear()} Qaretech Innovative. All rights reserved.
            </p>
            <p className="text-xs text-gray-500">
              Powered by Qaretech Innovative Subscription Management System
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};
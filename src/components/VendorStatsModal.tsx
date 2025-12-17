import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Vendor, Customer, Payment } from '../types';

interface VendorStatsModalProps {
  vendor: Vendor;
  onClose: () => void;
}

interface VendorStats {
  totalCustomers: number;
  activeCustomers: number;
  expiredCustomers: number;
  totalPayments: number;
  totalRevenue: number;
  recentPayments: Payment[];
  recentCustomers: Customer[];
}

export const VendorStatsModal: React.FC<VendorStatsModalProps> = ({ vendor, onClose }) => {
  const [stats, setStats] = useState<VendorStats>({
    totalCustomers: 0,
    activeCustomers: 0,
    expiredCustomers: 0,
    totalPayments: 0,
    totalRevenue: 0,
    recentPayments: [],
    recentCustomers: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [vendor.id]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch customers
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .eq('vendor_id', vendor.id);

      if (customersError) throw customersError;

      const now = new Date();
      const activeCustomers = customers?.filter(c => 
        c.is_active && new Date(c.expiry_date) > now
      ) || [];
      const expiredCustomers = customers?.filter(c => 
        new Date(c.expiry_date) <= now
      ) || [];

      // Fetch payments
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('vendor_id', vendor.id)
        .order('payment_date', { ascending: false })
        .limit(10);

      if (paymentsError) throw paymentsError;

      const totalRevenue = payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0;

      // Get recent customers
      const recentCustomers = customers
        ?.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 10) || [];

      setStats({
        totalCustomers: customers?.length || 0,
        activeCustomers: activeCustomers.length,
        expiredCustomers: expiredCustomers.length,
        totalPayments: payments?.length || 0,
        totalRevenue,
        recentPayments: payments || [],
        recentCustomers
      });
    } catch (error) {
      console.error('Error fetching vendor stats:', error);
      alert('Failed to load vendor statistics');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <span className="mr-2">📊</span>
            Vendor Statistics: {vendor.name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
          >
            <span className="text-gray-500">❌</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading statistics...</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="text-sm text-blue-600 font-medium">Total Customers</div>
                <div className="text-2xl font-bold text-blue-900 mt-1">{stats.totalCustomers}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <div className="text-sm text-green-600 font-medium">Active</div>
                <div className="text-2xl font-bold text-green-900 mt-1">{stats.activeCustomers}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                <div className="text-sm text-red-600 font-medium">Expired</div>
                <div className="text-2xl font-bold text-red-900 mt-1">{stats.expiredCustomers}</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <div className="text-sm text-purple-600 font-medium">Total Revenue</div>
                <div className="text-2xl font-bold text-purple-900 mt-1">GHC {stats.totalRevenue.toFixed(2)}</div>
              </div>
            </div>

            {/* Recent Payments */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Recent Payments ({stats.totalPayments} total)</h3>
              {stats.recentPayments.length > 0 ? (
                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Months</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {stats.recentPayments.map((payment) => (
                          <tr key={payment.id} className="bg-white">
                            <td className="px-4 py-2 text-sm text-gray-900">
                              {new Date(payment.payment_date).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-2 text-sm font-medium text-gray-900">
                              GHC {Number(payment.amount).toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600 capitalize">
                              {payment.payment_method?.replace('_', ' ')}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600">
                              {payment.months_paid}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
                  No payments found
                </div>
              )}
            </div>

            {/* Recent Customers */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Recent Customers</h3>
              {stats.recentCustomers.length > 0 ? (
                <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Expiry</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {stats.recentCustomers.map((customer) => {
                          const expiry = new Date(customer.expiry_date);
                          const daysUntil = Math.ceil((expiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                          const isExpired = daysUntil < 0;
                          const isExpiring = daysUntil <= 3 && daysUntil >= 0;
                          
                          return (
                            <tr key={customer.id} className="bg-white">
                              <td className="px-4 py-2 text-sm font-medium text-gray-900">{customer.name}</td>
                              <td className="px-4 py-2 text-sm text-gray-600">{customer.phone}</td>
                              <td className="px-4 py-2 text-sm text-gray-600">{customer.subscription_type}</td>
                              <td className="px-4 py-2 text-sm text-gray-600">
                                {new Date(customer.expiry_date).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-1 text-xs rounded-full ${
                                  isExpired ? 'bg-red-100 text-red-800' :
                                  isExpiring ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-green-100 text-green-800'
                                }`}>
                                  {isExpired ? 'Expired' : isExpiring ? 'Expiring' : 'Active'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
                  No customers found
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Vendor } from '../types';
import { VendorModal } from './VendorModal';
import { VendorEditModal } from './VendorEditModal';
import { VendorPasswordResetModal } from './VendorPasswordResetModal';
import { VendorStatsModal } from './VendorStatsModal';

interface VendorWithAdmin extends Vendor {
  adminEmail?: string;
  adminId?: string;
  customerCount?: number;
  paymentCount?: number;
  totalRevenue?: number;
}

export const VendorManagement: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<VendorWithAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorWithAdmin | null>(null);
  const [resettingPassword, setResettingPassword] = useState<VendorWithAdmin | null>(null);
  const [viewingStats, setViewingStats] = useState<VendorWithAdmin | null>(null);

  useEffect(() => {
    if (user?.role === 'super_admin') {
      fetchVendors();
    }
  }, [user]);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      // Fetch all vendors
      const { data: vendorsData, error: vendorsError } = await supabase
        .from('vendors')
        .select('*')
        .order('created_at', { ascending: false });

      if (vendorsError) throw vendorsError;

      // Fetch admin users for each vendor
      const vendorsWithAdmin = await Promise.all(
        (vendorsData || []).map(async (vendor) => {
          // Get admin user for this vendor
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('email, id')
            .eq('vendor_id', vendor.id)
            .eq('role', 'admin')
            .limit(1)
            .maybeSingle();

          // Get customer count
          const { count: customerCount } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('vendor_id', vendor.id);

          // Get payment count and total revenue
          const { data: paymentsData, count: paymentCount } = await supabase
            .from('payments')
            .select('amount', { count: 'exact' })
            .eq('vendor_id', vendor.id);

          const totalRevenue = paymentsData?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0;

          return {
            ...vendor,
            adminEmail: profilesData?.email,
            adminId: profilesData?.id,
            customerCount: customerCount || 0,
            paymentCount: paymentCount || 0,
            totalRevenue
          };
        })
      );

      setVendors(vendorsWithAdmin);
    } catch (error) {
      console.error('Error fetching vendors:', error);
      alert('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (vendor: VendorWithAdmin) => {
    if (!confirm(`Are you sure you want to delete "${vendor.name}"? This will also delete all associated customers, payments, and data. This action cannot be undone.`)) {
      return;
    }

    try {
      // Delete vendor (cascade will handle related data if foreign keys are set up)
      const { error } = await supabase
        .from('vendors')
        .delete()
        .eq('id', vendor.id);

      if (error) throw error;

      alert('Vendor deleted successfully');
      fetchVendors();
    } catch (error: any) {
      console.error('Error deleting vendor:', error);
      alert(`Failed to delete vendor: ${error.message}`);
    }
  };

  const filteredVendors = vendors.filter(v =>
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.adminEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.contact_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (user?.role !== 'super_admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">Access Denied</p>
          <p className="text-gray-600 mt-2">Only super admins can access this page.</p>
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Dashboard"
              >
                <span className="text-xl">←</span>
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Vendor Management</h1>
                <p className="text-sm text-gray-600">Manage all vendors and their admins</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Create Vendor
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <input
            type="text"
            placeholder="Search vendors by name, email, or contact..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Total Vendors</div>
            <div className="text-2xl font-bold text-gray-900">{vendors.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Total Customers</div>
            <div className="text-2xl font-bold text-gray-900">
              {vendors.reduce((sum, v) => sum + (v.customerCount || 0), 0)}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Total Payments</div>
            <div className="text-2xl font-bold text-gray-900">
              {vendors.reduce((sum, v) => sum + (v.paymentCount || 0), 0)}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Total Revenue</div>
            <div className="text-2xl font-bold text-gray-900">
              GHC {vendors.reduce((sum, v) => sum + (v.totalRevenue || 0), 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Vendors List */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading vendors...</p>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <p className="text-gray-600">
              {searchTerm ? 'No vendors found matching your search.' : 'No vendors found. Create your first vendor!'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stats</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredVendors.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {vendor.logo_url ? (
                            <img src={vendor.logo_url} alt={vendor.name} className="h-10 w-10 rounded-lg mr-3 object-cover" />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center mr-3">
                              <span className="text-blue-600 font-bold">{vendor.name.charAt(0).toUpperCase()}</span>
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900">{vendor.name}</div>
                            {vendor.slogan && (
                              <div className="text-xs text-gray-500">{vendor.slogan}</div>
                            )}
                            {vendor.website && (
                              <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                {vendor.website}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{vendor.adminEmail || 'No admin'}</div>
                        {!vendor.adminEmail && (
                          <div className="text-xs text-red-600">Admin not found</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {vendor.contact_email && <div>📧 {vendor.contact_email}</div>}
                          {vendor.contact_phone && <div>📞 {vendor.contact_phone}</div>}
                          {vendor.address && <div className="text-xs text-gray-500 mt-1">📍 {vendor.address}</div>}
                          {!vendor.contact_email && !vendor.contact_phone && (
                            <div className="text-xs text-gray-400">No contact info</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm">
                          <div className="text-gray-900">👥 {vendor.customerCount || 0} customers</div>
                          <div className="text-gray-600">💳 {vendor.paymentCount || 0} payments</div>
                          <div className="text-gray-600">💰 GHC {(vendor.totalRevenue || 0).toFixed(2)}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {vendor.created_at ? new Date(vendor.created_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => setViewingStats(vendor)}
                            className="text-blue-600 hover:text-blue-900"
                            title="View Statistics"
                          >
                            📊
                          </button>
                          <button
                            onClick={() => setEditingVendor(vendor)}
                            className="text-indigo-600 hover:text-indigo-900"
                            title="Edit Vendor"
                          >
                            ✏️
                          </button>
                          {vendor.adminId && (
                            <button
                              onClick={() => setResettingPassword(vendor)}
                              className="text-yellow-600 hover:text-yellow-900"
                              title="Reset Admin Password"
                            >
                              🔑
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(vendor)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete Vendor"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <VendorModal
          onClose={() => {
            setShowCreateModal(false);
            fetchVendors();
          }}
          onCreated={fetchVendors}
        />
      )}

      {editingVendor && (
        <VendorEditModal
          vendor={editingVendor}
          onClose={() => {
            setEditingVendor(null);
            fetchVendors();
          }}
          onUpdated={fetchVendors}
        />
      )}

      {resettingPassword && (
        <VendorPasswordResetModal
          vendor={resettingPassword}
          adminId={resettingPassword.adminId!}
          adminEmail={resettingPassword.adminEmail!}
          onClose={() => {
            setResettingPassword(null);
          }}
        />
      )}

      {viewingStats && (
        <VendorStatsModal
          vendor={viewingStats}
          onClose={() => {
            setViewingStats(null);
          }}
        />
      )}
    </div>
  );
};


import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface StaffModalProps {
  onClose: () => void;
}

interface Vendor {
  id: string;
  name: string;
}

export const StaffModal: React.FC<StaffModalProps> = ({ onClose }) => {
  const { register, user } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    role: 'staff' as 'admin' | 'staff',
    vendorId: user?.vendorId || ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // If super admin, fetch all vendors for selection
    if (user?.role === 'super_admin') {
      fetchVendors();
    }
  }, [user?.role]);

  const fetchVendors = async () => {
    setLoadingVendors(true);
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setVendors(data || []);
      
      // If no vendor selected and vendors exist, select first one
      if (!formData.vendorId && data && data.length > 0) {
        setFormData(prev => ({ ...prev, vendorId: data[0].id }));
      }
    } catch (err) {
      console.error('Error fetching vendors:', err);
      setError('Failed to load vendors');
    } finally {
      setLoadingVendors(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      // For super admin, use selected vendorId; for admin, use their own vendorId
      const targetVendorId = user?.role === 'super_admin' 
        ? formData.vendorId || null
        : user?.vendorId || null;

      if (user?.role === 'super_admin' && !targetVendorId) {
        throw new Error('Please select a vendor');
      }

      const result = await register(formData.email, formData.password, formData.role, targetVendorId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create staff account');
      }

      // Ensure vendor_id is set in profile (backup in case trigger didn't work)
      if (result.data?.user?.id && targetVendorId) {
        try {
          await supabase
            .from('profiles')
            .update({ vendor_id: targetVendorId })
            .eq('id', result.data.user.id);
        } catch (updateError) {
          console.warn('Could not update vendor_id in profile:', updateError);
          // Don't fail the whole operation if this update fails
        }
      }

      setSuccess('Staff account created successfully!');
      setFormData({ 
        email: '', 
        password: '', 
        role: 'staff',
        vendorId: user?.role === 'super_admin' ? (vendors[0]?.id || '') : (user?.vendorId || '')
      });
      
      // Close modal after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: any) {
      setError(error.message || 'Failed to create staff account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <span className="mr-2">👤➕</span>
            Create Staff Account
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
          >
            <span className="text-gray-500">❌</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
              {success}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">📧</span>
              Email Address *
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="staff@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">🔒</span>
              Password *
            </label>
            <input
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="Enter password"
              minLength={6}
            />
          </div>

          {/* Vendor Selection (Super Admin only) */}
          {user?.role === 'super_admin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <span className="inline mr-2">🏢</span>
                Vendor *
              </label>
              {loadingVendors ? (
                <div className="text-sm text-gray-500">Loading vendors...</div>
              ) : (
                <select
                  required
                  value={formData.vendorId}
                  onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">Select a vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Role *
            </label>
            <select
              required
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'staff' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Buttons */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors duration-200"
            >
              {isLoading ? 'Creating...' : 'Create Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
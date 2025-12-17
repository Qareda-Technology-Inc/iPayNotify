import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Vendor } from '../types';

interface StaffProfile {
  id: string;
  email: string;
  role: 'admin' | 'staff' | 'super_admin';
  vendor_id?: string;
  vendor_name?: string;
  created_at?: string;
}

export const StaffManagement: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [editingStaff, setEditingStaff] = useState<StaffProfile | null>(null);
  const [resettingPassword, setResettingPassword] = useState<StaffProfile | null>(null);

  useEffect(() => {
    if (user?.role === 'super_admin' || user?.role === 'admin') {
      fetchStaff();
      if (user?.role === 'super_admin') {
        fetchVendors();
      }
    }
  }, [user, selectedVendor]);

  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchStaff = async () => {
    setLoading(true);
    try {
      // First, get profiles
      let profilesQuery = supabase
        .from('profiles')
        .select('id, email, role, vendor_id, created_at')
        .order('created_at', { ascending: false });

      // Filter by vendor if not super admin or if vendor filter is selected
      if (user?.role === 'admin') {
        profilesQuery = profilesQuery.eq('vendor_id', user.vendorId);
      } else if (user?.role === 'super_admin' && selectedVendor !== 'all') {
        profilesQuery = profilesQuery.eq('vendor_id', selectedVendor);
      }

      // Exclude super_admin from list (they manage themselves)
      profilesQuery = profilesQuery.neq('role', 'super_admin');

      const { data: profiles, error: profilesError } = await profilesQuery;

      if (profilesError) throw profilesError;

      // Get vendor names for each profile
      const vendorIds = [...new Set((profiles || []).map((p: any) => p.vendor_id).filter(Boolean))];
      
      let vendorsMap: Record<string, string> = {};
      if (vendorIds.length > 0) {
        const { data: vendorsData } = await supabase
          .from('vendors')
          .select('id, name')
          .in('id', vendorIds);
        
        vendorsData?.forEach((v: any) => {
          vendorsMap[v.id] = v.name;
        });
      }

      const staffWithVendor = (profiles || []).map((profile: any) => ({
        id: profile.id,
        email: profile.email,
        role: profile.role,
        vendor_id: profile.vendor_id,
        vendor_name: profile.vendor_id ? (vendorsMap[profile.vendor_id] || 'No Vendor') : 'No Vendor',
        created_at: profile.created_at
      }));

      setStaff(staffWithVendor);
    } catch (error) {
      console.error('Error fetching staff:', error);
      alert('Failed to load staff members');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (staffMember: StaffProfile) => {
    if (!confirm(`Are you sure you want to delete staff member "${staffMember.email}"? This action cannot be undone.`)) {
      return;
    }

    try {
      // Try to delete profile first (cascade will handle auth.users if configured)
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', staffMember.id);

      if (profileError) {
        // If profile delete fails, try auth admin API (requires backend)
        console.warn('Profile delete failed, trying auth admin API:', profileError);
        // Note: supabase.auth.admin requires service role key, not available in client
        // In production, this should be done via a backend function
        throw new Error('Cannot delete user from client. Please use backend admin API or delete manually.');
      }

      alert('Staff member deleted successfully');
      fetchStaff();
    } catch (error: any) {
      console.error('Error deleting staff:', error);
      alert(`Failed to delete staff member: ${error.message}`);
    }
  };

  const handleRoleChange = async (staffMember: StaffProfile, newRole: 'admin' | 'staff') => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', staffMember.id);

      if (error) throw error;

      // Also update in auth metadata
      const { error: authError } = await supabase.auth.admin.updateUserById(staffMember.id, {
        user_metadata: {
          role: newRole,
          vendor_id: staffMember.vendor_id
        }
      });

      // If admin API fails, that's okay - profile update is the main thing
      if (authError) {
        console.warn('Could not update auth metadata:', authError);
      }

      alert(`Staff role updated to ${newRole}`);
      fetchStaff();
    } catch (error: any) {
      console.error('Error updating staff role:', error);
      alert(`Failed to update staff role: ${error.message}`);
    }
  };

  const filteredStaff = staff.filter(s =>
    (s.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
     s.vendor_name?.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (selectedVendor === 'all' || s.vendor_id === selectedVendor)
  );

  if (user?.role !== 'super_admin' && user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">Access Denied</p>
          <p className="text-gray-600 mt-2">Only admins and super admins can access this page.</p>
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
                <h1 className="text-xl font-bold text-gray-900">Staff Management</h1>
                <p className="text-sm text-gray-600">Manage staff members and their roles</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by email or vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {user?.role === 'super_admin' && (
              <div className="sm:w-64">
                <select
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Vendors</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Total Staff</div>
            <div className="text-2xl font-bold text-gray-900">{staff.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Admins</div>
            <div className="text-2xl font-bold text-blue-600">
              {staff.filter(s => s.role === 'admin').length}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="text-sm text-gray-600">Staff Members</div>
            <div className="text-2xl font-bold text-purple-600">
              {staff.filter(s => s.role === 'staff').length}
            </div>
          </div>
        </div>

        {/* Staff List */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading staff...</p>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <p className="text-gray-600">
              {searchTerm || selectedVendor !== 'all' 
                ? 'No staff members found matching your filters.' 
                : 'No staff members found.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    {user?.role === 'super_admin' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredStaff.map((staffMember) => (
                    <tr key={staffMember.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{staffMember.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={staffMember.role}
                          onChange={(e) => handleRoleChange(staffMember, e.target.value as 'admin' | 'staff')}
                          className="text-sm px-2 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      {user?.role === 'super_admin' && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{staffMember.vendor_name}</div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {staffMember.created_at 
                          ? new Date(staffMember.created_at).toLocaleDateString() 
                          : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => setResettingPassword(staffMember)}
                            className="text-yellow-600 hover:text-yellow-900"
                            title="Reset Password"
                          >
                            🔑
                          </button>
                          <button
                            onClick={() => handleDelete(staffMember)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete Staff"
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

      {/* Password Reset Modal */}
      {resettingPassword && (
        <StaffPasswordResetModal
          staff={resettingPassword}
          onClose={() => setResettingPassword(null)}
        />
      )}
    </div>
  );
};

interface StaffPasswordResetModalProps {
  staff: StaffProfile;
  onClose: () => void;
}

const StaffPasswordResetModal: React.FC<StaffPasswordResetModalProps> = ({ staff, onClose }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      // Note: Password reset requires Supabase Admin API (service role key)
      // This won't work from the client. In production, use a backend function.
      // For now, we'll show a message that this requires backend implementation
      
      // Attempt to use admin API (will fail in client, but shows the intent)
      try {
        const { error: updateError } = await supabase.auth.admin.updateUserById(staff.id, {
          password: newPassword
        });

        if (updateError) {
          throw updateError;
        }

        setSuccess(`Password reset for ${staff.email}. The new password is: ${newPassword}`);
      } catch (adminError: any) {
        // Admin API not available from client
        setError('Password reset requires backend implementation. Please use Supabase Admin API via a serverless function.');
        console.error('Admin API error:', adminError);
        return;
      }
      
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  const generateRandomPassword = () => {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setNewPassword(password);
    setConfirmPassword(password);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <span className="mr-2">🔑</span>
            Reset Staff Password
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
          >
            <span className="text-gray-500">❌</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">{success}</div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            <p className="font-medium">Staff: {staff.email}</p>
            <p className="mt-1">Role: {staff.role}</p>
            {staff.vendor_name && (
              <p className="mt-1">Vendor: {staff.vendor_name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Password *
            </label>
            <div className="flex space-x-2">
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={generateRandomPassword}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                title="Generate random password"
              >
                🎲
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Password *
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Confirm new password"
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            <p className="font-medium">⚠️ Important:</p>
            <p className="mt-1">In production, password reset should be handled via a secure backend function using Supabase Admin API. The new password should be securely communicated to the staff member.</p>
          </div>

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
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200"
            >
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


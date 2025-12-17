import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Vendor } from '../types';

interface VendorSettingsModalProps {
  onClose: () => void;
}

export const VendorSettingsModal: React.FC<VendorSettingsModalProps> = ({ onClose }) => {
  const { user } = useAuth();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [formData, setFormData] = useState<Partial<Vendor>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchVendor = async () => {
    setLoading(true);
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', user?.vendorId)
        .maybeSingle();
      if (error) throw error;
      setVendor(data || null);
      setFormData(data || {});
    } catch (e) {
      console.error('Error loading vendor settings:', e);
      setError('Failed to load vendor settings');
    } finally {
      setIsLoading(false);
      setLoading(false);
    }
  };

  // Refetch vendor data whenever modal is opened (when component mounts)
  useEffect(() => {
    if (user?.vendorId) {
      fetchVendor();
    }
  }, [user?.vendorId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsLoading(true); 
    setError('');
    
    try {
      const vendorData: Partial<Vendor> = {
        name: formData.name,
        slogan: formData.slogan || null,
        address: formData.address || null,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        logo_url: formData.logo_url || null,
        website: formData.website || null,
        updated_at: new Date().toISOString()
      };

      if (vendor) {
        // Update existing vendor
        const { error } = await supabase
          .from('vendors')
          .update(vendorData)
          .eq('id', user?.vendorId);
        if (error) throw error;
      } else {
        // Create new vendor (shouldn't normally happen, but handle it)
        if (!user?.vendorId) {
          throw new Error('Vendor ID not found. Please contact your super admin.');
        }
        const { error } = await supabase
          .from('vendors')
          .insert([{ ...vendorData, id: user.vendorId }]);
        if (error) throw error;
      }
      
      // Refetch vendor data after update/create to ensure UI is in sync
      await fetchVendor();
      
      // Show success message briefly before closing
      setError(''); // Clear any previous errors
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (e: any) {
      console.error('Error saving vendor settings:', e);
      setError(e.message || 'Failed to save settings');
    } finally { 
      setIsLoading(false); 
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-2xl p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading company settings...</p>
          </div>
        </div>
      </div>
    );
  }

  // If no vendor record exists, allow the admin to create it
  if (!vendor) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                <span className="mr-3 text-3xl">🏢</span>
                Create Company Profile
              </h2>
              <p className="text-sm text-gray-600 mt-1">Set up your company details to get started</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white rounded-lg transition-colors duration-200"
            >
              <span className="text-gray-500 text-xl">✕</span>
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4">
                <div className="flex items-center">
                  <span className="text-red-400 mr-2">⚠️</span>
                  <p className="text-red-700 text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">💡 Tip:</span> You can add more details like contact information, logo, and website after creating your profile.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <span className="inline mr-2">🏢</span>
                Company Name *
              </label>
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900"
                placeholder="Enter your company name"
              />
            </div>

            <div className="flex space-x-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors duration-200 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                    Creating...
                  </span>
                ) : (
                  'Create Profile'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 p-3 rounded-lg">
              <span className="text-white text-2xl">⚙️</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Company Settings</h2>
              <p className="text-sm text-gray-600">Manage your company information and branding</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchVendor}
              disabled={loading || isLoading}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-white rounded-lg transition-colors disabled:opacity-50"
              title="Refresh vendor data"
            >
              <span className="text-xl">🔄</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-white rounded-lg transition-colors"
            >
              <span className="text-xl">✕</span>
            </button>
          </div>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4">
              <div className="flex items-center">
                <span className="text-red-400 mr-2 text-xl">⚠️</span>
                <p className="text-red-700 text-sm font-medium">{error}</p>
              </div>
            </div>
          )}

          {/* Basic Information Section */}
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">📋</span>
              Basic Information
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">🏢</span>
                  Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="Enter company name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">💬</span>
                  Company Slogan
                </label>
                <input
                  type="text"
                  value={formData.slogan || ''}
                  onChange={e => setFormData({ ...formData, slogan: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="Your company slogan (appears in SMS messages)"
                />
                <p className="text-xs text-gray-500 mt-1">This will appear at the bottom of SMS messages sent to customers</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">📍</span>
                  Address
                </label>
                <textarea
                  rows={3}
                  value={formData.address || ''}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 resize-none"
                  placeholder="Company address"
                />
              </div>
            </div>
          </div>

          {/* Contact Information Section */}
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">📞</span>
              Contact Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">📧</span>
                  Contact Email
                </label>
                <input
                  type="email"
                  value={formData.contact_email || ''}
                  onChange={e => setFormData({ ...formData, contact_email: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="contact@example.com"
                />
                <p className="text-xs text-gray-500 mt-1">Used in SMS templates for support contact</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">📱</span>
                  Contact Phone
                </label>
                <input
                  type="tel"
                  value={formData.contact_phone || ''}
                  onChange={e => setFormData({ ...formData, contact_phone: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="+233241234567"
                />
                <p className="text-xs text-gray-500 mt-1">Used in SMS templates and as sender ID</p>
              </div>
            </div>
          </div>

          {/* Branding Section */}
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">🎨</span>
              Branding
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">🌐</span>
                  Website
                </label>
                <input
                  type="url"
                  value={formData.website || ''}
                  onChange={e => setFormData({ ...formData, website: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="https://example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">🖼️</span>
                  Logo URL
                </label>
                <input
                  type="url"
                  value={formData.logo_url || ''}
                  onChange={e => setFormData({ ...formData, logo_url: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  placeholder="https://example.com/logo.png"
                />
                {formData.logo_url && (
                  <div className="mt-3 p-3 bg-white border-2 border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-600 mb-2">Logo Preview:</p>
                    <img
                      src={formData.logo_url}
                      alt="Logo preview"
                      className="h-20 w-20 object-contain rounded-lg border border-gray-300"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors duration-200 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                  Saving Changes...
                </span>
              ) : (
                <span className="flex items-center justify-center">
                  <span className="mr-2">💾</span>
                  Save Changes
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

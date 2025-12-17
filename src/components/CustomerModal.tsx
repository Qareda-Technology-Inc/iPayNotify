import React, { useState } from 'react';
import { Customer } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { sendSMS } from '../lib/smsService';
import { addMonths } from 'date-fns';
import { templateWelcome } from '../lib/messageTemplates';
import { useVendor } from '../hooks/useVendor';

interface CustomerModalProps {
  customer?: Customer;
  onClose: () => void;
  onSave: () => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({ customer, onClose, onSave }) => {
  const { user } = useAuth();
  const { vendor } = useVendor();
  const [formData, setFormData] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    subscription_type: customer?.subscription_type || 'Basic' as const,
    monthly_fee: customer?.monthly_fee || 0,
    subscription_date: customer?.subscription_date 
      ? new Date(customer.subscription_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    notes: customer?.notes || ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Date formatting moved to templates

  const sendWelcomeMessageSMS = async (customerData: any, endDate: Date) => {
    try {
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      const message = templateWelcome(customerData.name, endDate, vendorData);
      await sendSMS(customerData.phone, message, vendor?.name);
      console.log(`Welcome SMS sent to ${customerData.name}`);
      
    } catch (error) {
      console.error(`Error sending welcome SMS to ${customerData.name}:`, error);
      throw error;
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const subscriptionDate = new Date(formData.subscription_date);
      const expiryDate = addMonths(subscriptionDate, 1);
      
      const customerData: any = {
        name: formData.name,
        phone: formData.phone,
        subscription_type: formData.subscription_type,
        monthly_fee: formData.monthly_fee,
        subscription_date: formData.subscription_date,
        expiry_date: expiryDate.toISOString().split('T')[0],
        is_active: true,
        notes: formData.notes || null,
        created_by: user?.id,
        vendor_id: user?.vendorId || null
      };
      
      if (customer) {
        // Update existing customer
        const { error } = await supabase
          .from('customers')
          .update(customerData)
          .eq('id', customer.id);

        if (error) {
          console.error('Update customer error:', error);
          throw new Error(`Failed to update customer: ${error.message}`);
        }
      } else {
        // Add new customer
        const { error } = await supabase
          .from('customers')
          .insert([customerData]);

        if (error) {
          console.error('Create customer error:', error);
          throw new Error(`Failed to create customer: ${error.message}`);
        }
        // Send welcome SMS to new customers
        try {
          await sendWelcomeMessageSMS(customerData, expiryDate);
        } catch (smsError) {
          console.error('Welcome SMS failed:', smsError);
          alert('Customer created successfully, but welcome SMS failed to send.');
        }
      }
      
      onSave();
      onClose();
    } catch (error: any) {
      console.error('Error saving customer:', error);
      setError(error.message || 'Failed to save customer');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {customer ? 'Edit Customer' : 'Add New Customer'}
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

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">👤</span>
              Full Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter customer name"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">📞</span>
              Phone Number *
            </label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="+233241234567"
            />
          </div>

          {/* Subscription Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Subscription Type *
            </label>
            <select
              required
              value={formData.subscription_type}
              onChange={(e) => setFormData({ ...formData, subscription_type: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="Basic">Basic</option>
              <option value="Standard">Standard</option>
              <option value="Premium">Premium</option>
              <option value="Enterprise">Enterprise</option>
            </select>
          </div>

          {/* Monthly Fee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">💳</span>
              Monthly Fee (GHC) *
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={formData.monthly_fee}
              onChange={(e) => setFormData({ ...formData, monthly_fee: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="200.00"
            />
          </div>

          {/* Subscription Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">📅</span>
              Subscription Date *
            </label>
            <input
              type="date"
              required
              value={formData.subscription_date}
              onChange={(e) => setFormData({ ...formData, subscription_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Additional notes..."
            />
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
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200"
            >
              {isLoading ? 'Saving...' : 'Save Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
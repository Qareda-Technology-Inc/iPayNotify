import React, { useState } from 'react';
import { Customer } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { sendSMS } from '../lib/smsService';
import { addMonths } from 'date-fns';
import { templateActivation, templatePaymentConfirmation } from '../lib/messageTemplates';
import { useVendor } from '../hooks/useVendor';

interface PaymentModalProps {
  customer: Customer;
  onClose: () => void;
  onSave: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ customer, onClose, onSave }) => {
  const { user } = useAuth();
  const { vendor } = useVendor();
  const [formData, setFormData] = useState({
    amount: customer.monthly_fee,
    payment_method: 'mobile_money' as const,
    payment_reference: '',
    payment_date: new Date().toISOString().split('T')[0],
    months_paid: 1,
    notes: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Date formatting moved to templates

  const sendPaymentConfirmationSMS = async (
    customer: Customer, 
    amount: number, 
    newEndDate: Date
  ) => {
    try {
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      const message = templatePaymentConfirmation(customer.name, amount, newEndDate, vendorData);
      await sendSMS(customer.phone, message, vendor?.name);
      console.log(`Payment confirmation SMS sent to ${customer.name}`);
      
    } catch (error) {
      console.error(`Error sending payment confirmation SMS to ${customer.name}:`, error);
      throw error;
    }
  };

  const sendServiceActivationSMS = async (customer: Customer, newEndDate: Date) => {
    try {
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      const message = templateActivation(customer.name, newEndDate, vendorData);
      await sendSMS(customer.phone, message, vendor?.name);
      console.log(`Service activation SMS sent to ${customer.name}`);
      
    } catch (error) {
      console.error(`Error sending activation SMS to ${customer.name}:`, error);
      throw error;
    }
  };

  // Welcome SMS handled in Customer creation flow
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Calculate new expiry date
      const currentExpiry = new Date(customer.expiry_date);
      const now = new Date();
      const startDate = currentExpiry > now ? currentExpiry : now;
      
      const newExpiry = addMonths(startDate, formData.months_paid);
      
      // Store old expiry date for SMS
      const oldExpiry = new Date(customer.expiry_date);
      const wasExpired = oldExpiry < now;
      
      // Create payment record
      const paymentData: any = {
        customer_id: customer.id,
        amount: formData.amount,
        payment_method: formData.payment_method,
        payment_reference: formData.payment_reference || null,
        payment_date: formData.payment_date,
        months_paid: formData.months_paid,
        notes: formData.notes || null,
        created_by: user?.id,
        vendor_id: user?.vendorId || null
      };
      
      const { error: paymentError } = await supabase
        .from('payments')
        .insert([paymentData]);

      if (paymentError) {
        throw new Error(`Failed to record payment: ${paymentError.message}`);
      }

      // Update customer expiry date and activate if needed
      const { error: customerError } = await supabase
        .from('customers')
        .update({
          expiry_date: newExpiry.toISOString().split('T')[0],
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', customer.id);

      if (customerError) {
        throw new Error(`Failed to update customer: ${customerError.message}`);
      }
      
      // Send SMS notifications
      try {
        // Always send payment confirmation
        await sendPaymentConfirmationSMS(
          customer, 
          formData.amount * formData.months_paid, 
          newExpiry
        );
        
        // If service was expired and is now activated, send activation SMS
        if (wasExpired) {
          await sendServiceActivationSMS(customer, newExpiry);
        }
        
      } catch (smsError) {
        console.error('SMS sending failed:', smsError);
        // Don't fail the payment process if SMS fails
        alert('Payment processed successfully, but SMS notification failed to send.');
      }
      
      onSave();
      onClose();
    } catch (error: any) {
      console.error('Error processing payment:', error);
      setError(error.message || 'Failed to process payment');
    } finally {
      setIsLoading(false);
    }
  };

  const totalAmount = formData.amount * formData.months_paid;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 flex items-center">
            <span className="mr-2">💳</span>
            Process Payment
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
          >
            <span className="text-gray-500">❌</span>
          </button>
        </div>

        {/* Customer Info */}
        <div className="p-4 sm:p-6 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 font-medium text-sm">
                {customer.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">{customer.name}</h3>
              <p className="text-sm text-gray-600">{customer.phone}</p>
              <p className="text-xs text-gray-500">
                Current expiry: {new Date(customer.expiry_date).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">💰</span>
              Payment Method *
            </label>
            <select
              required
              value={formData.payment_method}
              onChange={(e) => setFormData({ ...formData, payment_method: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="mobile_money">📱 Mobile Money</option>
              <option value="cash">💵 Cash</option>
              <option value="bank_transfer">🏦 Bank Transfer</option>
              <option value="card">💳 Card</option>
            </select>
          </div>

          {/* Payment Reference */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">🔢</span>
              Payment Reference
            </label>
            <input
              type="text"
              value={formData.payment_reference}
              onChange={(e) => setFormData({ ...formData, payment_reference: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Transaction ID, Receipt #, etc."
            />
          </div>

          {/* Payment Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">📅</span>
              Payment Date *
            </label>
            <input
              type="date"
              required
              value={formData.payment_date}
              onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Months Paid */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">📆</span>
              Months to Pay *
            </label>
            <select
              required
              value={formData.months_paid}
              onChange={(e) => setFormData({ ...formData, months_paid: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {[1, 2, 3, 6, 12].map(months => (
                <option key={months} value={months}>
                  {months} month{months > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Amount per Month */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="inline mr-2">💵</span>
              Amount per Month (GHC) *
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Total Amount Display */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-blue-700">Total Amount:</span>
              <span className="text-lg font-bold text-blue-900">GHC {totalAmount.toFixed(2)}</span>
            </div>
            <p className="text-xs text-blue-600 mt-1">
              {formData.months_paid} month{formData.months_paid > 1 ? 's' : ''} × GHC {formData.amount}
            </p>
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
              placeholder="Additional payment notes..."
            />
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 pt-4">
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
              {isLoading ? 'Processing...' : 'Process Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
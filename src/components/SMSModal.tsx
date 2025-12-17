import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Customer } from '../types';
import { sendSMS } from '../lib/smsService';
import { templateMaintenance, templateNetworkUpdate, templateWelcome, templateExpiring, templateExpired } from '../lib/messageTemplates';
import { useAuth } from '../hooks/useAuth';
import { useVendor } from '../hooks/useVendor';

interface SMSModalProps {
  onClose: () => void;
}

type MessageType = 'custom' | 'maintenance' | 'update' | 'welcome' | 'expiring' | 'expired';

export const SMSModal: React.FC<SMSModalProps> = ({ onClose }) => {
  const { user } = useAuth();
  const { vendor } = useVendor();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [formData, setFormData] = useState({
    phone: '',
    customerName: '',
    message: '',
    messageType: 'custom' as MessageType
  });
  const [preview, setPreview] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  React.useEffect(() => {
    fetchCustomers();
  }, []);

  // Generate preview when inputs change
  useEffect(() => {
    const gen = () => {
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      
      const name = selectedCustomers.length === 1
        ? customers.find(c => c.id === selectedCustomers[0])?.name || formData.customerName
        : formData.customerName;
      if (selectedCustomers.length >= 1) {
        const customer = customers.find(c => c.id === selectedCustomers[0]);
        if (customer) {
          const expiry = new Date(customer.expiry_date);
          const daysUntil = Math.ceil((expiry.getTime() - new Date().getTime()) / (1000*60*60*24));
          switch (formData.messageType) {
            case 'maintenance': return templateMaintenance('11 PM - 2 AM', vendorData);
            case 'update': return templateNetworkUpdate(vendorData);
            case 'welcome': return templateWelcome(customer.name, expiry, vendorData);
            case 'expiring': return templateExpiring(customer.name, daysUntil, expiry, vendorData);
            case 'expired': return templateExpired(customer.name, Math.abs(daysUntil), expiry, vendorData);
            default: return formData.message;
          }
        }
      }
      // single phone/manual content
      return formData.message;
    };
    setPreview(gen());
  }, [formData, selectedCustomers, customers, vendor]);

  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    try {
      let query = supabase
        .from('customers')
        .select('*')
        .eq('is_active', true)
        .order('name');

      // Scope by vendor when available (non-super admin)
      if (user?.vendorId) {
        query = query.eq('vendor_id', user.vendorId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCustomers(data || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const getPresetMessage = (type: MessageType, customerName: string = '') => {
    const vendorData = vendor ? {
      name: vendor.name,
      contact_phone: vendor.contact_phone,
      slogan: vendor.slogan
    } : undefined;
    
    switch (type) {
      case 'maintenance':
        return templateMaintenance('11 PM - 2 AM', vendorData);
      case 'update':
        return templateNetworkUpdate(vendorData);
      case 'welcome':
        // For manual entry; expiry date unknown, keep generic welcome
        return templateWelcome(customerName || 'Customer', new Date(), vendorData);
      default:
        return '';
    }
  };

  const handleMessageTypeChange = (type: MessageType) => {
    const name = selectedCustomers.length === 1 
      ? customers.find(c => c.id === selectedCustomers[0])?.name || ''
      : formData.customerName;
      
    setFormData({
      ...formData,
      messageType: type,
      message: getPresetMessage(type, name)
    });
  };

  const handleCustomerSelect = (customerId: string) => {
    setSelectedCustomers(prev => 
      prev.includes(customerId) 
        ? prev.filter(id => id !== customerId)
        : [...prev, customerId]
    );
  };

  const selectAllExpiring = () => {
    const now = new Date();
    const expiringCustomers = customers.filter(customer => {
      const expiry = new Date(customer.expiry_date);
      const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntil <= 3 && daysUntil > 0;
    });
    setSelectedCustomers(expiringCustomers.map(c => c.id!));
  };

  const selectAllExpired = () => {
    const now = new Date();
    const expiredCustomers = customers.filter(customer => {
      const expiry = new Date(customer.expiry_date);
      return expiry <= now;
    });
    setSelectedCustomers(expiredCustomers.map(c => c.id!));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      const vendorData = vendor ? {
        name: vendor.name,
        contact_phone: vendor.contact_phone,
        slogan: vendor.slogan
      } : undefined;
      
      if (selectedCustomers.length > 0) {
        // Get selected customers with their details
        const selectedCustomerDetails = customers.filter(c => selectedCustomers.includes(c.id!));
        
        if (selectedCustomerDetails.length > 1) {
          // For multiple customers, send personalized messages individually
          let successful = 0;
          let failed = 0;
          const errors: string[] = [];
          
          for (const customer of selectedCustomerDetails) {
            try {
              // Create personalized message for each customer
                let personalizedMessage = formData.message;
                if (formData.messageType !== 'custom') {
                  if (formData.messageType === 'welcome') {
                    personalizedMessage = templateWelcome(customer.name, new Date(customer.expiry_date), vendorData);
                  } else if (formData.messageType === 'expiring' || formData.messageType === 'expired') {
                    const expiry = new Date(customer.expiry_date);
                    const now = new Date();
                    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysUntil < 0) {
                      personalizedMessage = templateExpired(customer.name, Math.abs(daysUntil), expiry, vendorData);
                    } else {
                      personalizedMessage = templateExpiring(customer.name, daysUntil, expiry, vendorData);
                    }
                  } else if (formData.messageType === 'maintenance') {
                    personalizedMessage = templateMaintenance('11 PM - 2 AM', vendorData);
                  } else if (formData.messageType === 'update') {
                    personalizedMessage = templateNetworkUpdate(vendorData);
                  }
                }
                
              await sendSMS(customer.phone, personalizedMessage, vendor?.name);
              successful++;
            } catch (error) {
              failed++;
              errors.push(`${customer.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
          
          setResult({
            success: successful > 0,
            message: successful > 0 
              ? `Personalized SMS sent to ${successful} customer(s)${failed > 0 ? `. ${failed} failed: ${errors.join(', ')}` : '!'}`
              : `Failed to send SMS: ${errors.join(', ')}`
          });
        } else {
          // Single customer - personalize the message
          const customer = selectedCustomerDetails[0];
          let personalizedMessage = formData.message;
          if (formData.messageType !== 'custom') {
            if (formData.messageType === 'welcome') {
              personalizedMessage = templateWelcome(customer.name, new Date(customer.expiry_date), vendorData);
            } else if (formData.messageType === 'expiring' || formData.messageType === 'expired') {
              const expiry = new Date(customer.expiry_date);
              const now = new Date();
              const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (daysUntil < 0) {
                personalizedMessage = templateExpired(customer.name, Math.abs(daysUntil), expiry, vendorData);
              } else {
                personalizedMessage = templateExpiring(customer.name, daysUntil, expiry, vendorData);
              }
            } else if (formData.messageType === 'maintenance') {
              personalizedMessage = templateMaintenance('11 PM - 2 AM', vendorData);
            } else if (formData.messageType === 'update') {
              personalizedMessage = templateNetworkUpdate(vendorData);
            }
          }
            
          await sendSMS(customer.phone, personalizedMessage, vendor?.name);
          setResult({
            success: true,
            message: `Personalized SMS sent successfully to ${customer.name}!`
          });
        }
        
        // Update last_reminder_sent for selected customers
        await supabase
          .from('customers')
          .update({ last_reminder_sent: new Date().toISOString() })
          .in('id', selectedCustomers);
          
      } else if (formData.phone) {
        // Single phone number entry
        await sendSMS(formData.phone, formData.message, vendor?.name);
        setResult({
          success: true,
          message: 'SMS sent successfully!'
        });
      } else {
        throw new Error('Please select customers or enter a phone number');
      }

    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send SMS via Arkesel. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <span className="mr-2">💬</span>
            Send SMS
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
          >
            <span className="text-gray-500">❌</span>
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {result && (
            <div className={`p-3 rounded-lg text-sm ${
              result.success 
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {result.message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Message Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Type
              </label>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('custom')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'custom'
                      ? 'bg-blue-100 text-blue-700 border border-blue-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  Custom
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('maintenance')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'maintenance'
                      ? 'bg-orange-100 text-orange-700 border border-orange-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  🔧 Maintenance
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('update')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'update'
                      ? 'bg-green-100 text-green-700 border border-green-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  🆕 Update
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('welcome')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'welcome'
                      ? 'bg-purple-100 text-purple-700 border border-purple-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  🎉 Welcome
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('expiring')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'expiring'
                      ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  ⏰ Expiring
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageTypeChange('expired')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    formData.messageType === 'expired'
                      ? 'bg-red-100 text-red-700 border border-red-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  ⛔ Expired
                </button>
              </div>
            </div>

            {/* Customer Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Send to Customers
              </label>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectAllExpiring}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition-colors"
                >
                  ⚠️ Select Expiring (≤3 days)
                </button>
                <button
                  type="button"
                  onClick={selectAllExpired}
                  className="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-sm hover:bg-green-200 transition-colors"
                >
                  ⛔ Select Expired
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCustomers([])}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                >
                  Clear Selection
                </button>
              </div>
              
              {loadingCustomers ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600 mx-auto"></div>
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
                  {customers.map(customer => {
                    const expiry = new Date(customer.expiry_date);
                    const now = new Date();
                    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const isExpiring = daysUntil <= 3 && daysUntil > 0;
                    const isExpired = expiry <= now;
                    
                    return (
                      <label key={customer.id} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCustomers.includes(customer.id!)}
                          onChange={() => handleCustomerSelect(customer.id!)}
                          className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900 truncate">
                              {customer.name}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              isExpired ? 'bg-red-100 text-red-700' :
                              isExpiring ? 'bg-yellow-100 text-yellow-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {isExpired ? 'Expired' : isExpiring ? 'Expiring' : 'Active'}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">{customer.phone}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {selectedCustomers.length} customer(s) selected
              </p>
            </div>

            {/* Phone Number */}
            <div className={selectedCustomers.length > 0 ? 'opacity-50' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <span className="inline mr-2">📞</span>
                Or Enter Phone Number
              </label>
              <input
                type="tel"
                required={selectedCustomers.length === 0}
                disabled={selectedCustomers.length > 0}
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100"
                placeholder="+233241234567"
              />
              <p className="text-xs text-gray-500 mt-1">
                Use this field only if not sending to selected customers
              </p>
            </div>

            {/* Customer Name for manual entry */}
            {selectedCustomers.length === 0 && ['welcome', 'expiring', 'expired'].includes(formData.messageType) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="inline mr-2">👤</span>
                  Customer Name (Optional)
                </label>
                <input
                  type="text"
                  value={formData.customerName}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setFormData({ 
                      ...formData, 
                      customerName: newName,
                      message: getPresetMessage(formData.messageType, newName)
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="Enter customer name for personalization"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Name will be used in the message greeting
                </p>
              </div>
            )}

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message *
              </label>
              <textarea
                required
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                rows={4}
                maxLength={320}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Enter your message here..."
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.message.length}/320 characters
              </p>
            </div>

            {/* Preview */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Preview
              </label>
              <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 text-sm text-gray-800">
                {preview}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex space-x-3 pt-4">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors duration-200 flex items-center justify-center"
              >
                <span className="mr-2">📤</span>
               {isLoading ? 'Sending via Arkesel...' : `Send SMS${selectedCustomers.length > 0 ? ` (${selectedCustomers.length})` : ''}`}
              </button>
            </div>
          </form>

          <div className="border-t border-gray-200 pt-4 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors duration-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
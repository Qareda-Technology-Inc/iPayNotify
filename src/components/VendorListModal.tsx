import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export const VendorListModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('vendors').select('id, name').order('created_at', { ascending: false });
      if (error) throw error;
      setVendors(data || []);
    } catch (e) {
      console.error('Error loading vendors:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (id: string, currentName: string) => {
    const newName = prompt('Enter new vendor name', currentName);
    if (!newName || newName === currentName) return;
    try {
      const { error } = await supabase.from('vendors').update({ name: newName }).eq('id', id);
      if (error) throw error;
      fetchVendors();
    } catch (e) {
      console.error('Error updating vendor:', e);
      alert('Failed to update vendor');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vendor and all its data? This cannot be undone.')) return;
    try {
      const { error } = await supabase.from('vendors').delete().eq('id', id);
      if (error) throw error;
      fetchVendors();
    } catch (e) {
      console.error('Error deleting vendor:', e);
      alert('Failed to delete vendor');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Manage Vendors</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✖️</button>
        </div>
        <div className="p-4">
          {loading ? (
            <p>Loading...</p>
          ) : vendors.length > 0 ? (
            <ul className="space-y-2">
              {vendors.map(v => (
                <li key={v.id} className="flex justify-between items-center border-b pb-2">
                  <span>{v.name}</span>
                  <div className="space-x-2">
                    <button onClick={() => handleEdit(v.id, v.name)} className="text-blue-600">Edit</button>
                    <button onClick={() => handleDelete(v.id)} className="text-red-600">Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No vendors found.</p>
          )}
        </div>
      </div>
    </div>
  );
};

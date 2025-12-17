import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Vendor } from '../types';

export function useVendor() {
  const { user } = useAuth();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVendor = useCallback(async () => {
    if (!user?.vendorId) {
      setVendor(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', user.vendorId)
        .maybeSingle();
      
      if (fetchError) {
        throw fetchError;
      }
      
      setVendor(data || null);
    } catch (err: any) {
      console.error('Error loading vendor settings:', err);
      setError(err.message || 'Failed to load vendor settings.');
      setVendor(null);
    } finally {
      setLoading(false);
    }
  }, [user?.vendorId]);

  useEffect(() => {
    fetchVendor();
  }, [fetchVendor]);

  return { vendor, loading, error, refresh: fetchVendor };
}

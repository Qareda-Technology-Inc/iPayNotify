import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'staff' | 'super_admin'
  vendorId: string | null
}

export const useAuth = () => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  console.log('useAuth hook - user:', user, 'loading:', loading);

  useEffect(() => {
    let mounted = true;
    
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Initial session:', session);
        
        if (!mounted) return;
        
        if (session?.user) {
          await fetchUserProfile(session.user);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };
    
    initializeAuth();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Initial session:', session);
      
      if (!mounted) return;
      
      try {
        if (session?.user) {
          await fetchUserProfile(session.user);
        } else {
          setUser(null);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error in auth state change:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [])

  const fetchUserProfile = async (authUser: User) => {
    console.log('Fetching profile for user:', authUser.id);
    try {
      setLoading(true); // Ensure loading is set
      
      // Use JWT metadata directly instead of querying profiles table
      const userRole = (authUser.user_metadata?.role as string) || 'staff';
      const vendorId = (authUser.user_metadata?.vendor_id as string) || null;
      console.log('Setting user with role:', userRole, 'vendor:', vendorId);
      
      setUser({
        id: authUser.id,
        email: authUser.email!,
        role: (userRole as 'admin' | 'staff' | 'super_admin'),
        vendorId
      });
      
      console.log('User state updated:', {
        id: authUser.id,
        email: authUser.email,
        role: userRole,
        vendorId
      });
      
    } catch (error) {
      console.error('Error in fetchUserProfile:', error)
      
      // Fallback
      const fallbackRole = (authUser.user_metadata?.role as string) || 'staff';
      const vendorId = (authUser.user_metadata?.vendor_id as string) || null;
      console.log('Setting fallback user due to error, role:', fallbackRole);
      
      setUser({
        id: authUser.id,
        email: authUser.email!,
        role: (fallbackRole as 'admin' | 'staff' | 'super_admin'),
        vendorId
      });
    } finally {
      console.log('Setting loading to false');
      setLoading(false)
    }
  }

  // Add function to manually refresh user profile
  const refreshUserProfile = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await fetchUserProfile(authUser);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        return { success: false, error: error.message }
      }

      // Force refresh profile after login
      if (data.user) {
        await fetchUserProfile(data.user);
      }

      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  const register = async (
    email: string,
    password: string,
    role: 'admin' | 'staff' | 'super_admin' = 'staff',
    vendorId?: string | null
  ) => {
    try {
      console.log('Attempting to register user:', { email, role, vendorId });
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: undefined, // Disable email confirmation redirect
          data: {
            role,
            vendor_id: vendorId || null
          }
        }
      })

      console.log('Registration result:', { data, error });

      if (error) {
        console.error('Registration error:', error);
        return { success: false, error: error.message }
      }

      return { success: true, data }
    } catch (error: any) {
      console.error('Registration exception:', error);
      return { success: false, error: error.message }
    }
  }

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        return { success: false, error: error.message }
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  return {
    user,
    loading,
    login,
    register,
    logout,
    refreshUserProfile
  }
}
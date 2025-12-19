import React from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginForm } from './components/LoginForm';
import { Dashboard } from './components/Dashboard';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';

function App() {
  const { user, loading } = useAuth();

  // Debug logging
  console.log('App render - user:', user, 'loading:', loading);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {user ? <Dashboard /> : <LoginForm />}
      <PWAInstallPrompt />
    </>
  );
}

export default App;
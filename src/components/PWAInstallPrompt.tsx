import React, { useState, useEffect } from 'react';

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Listen for the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if prompt was already available
    window.addEventListener('pwa-install-available', () => {
      setShowPrompt(true);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }

    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Store dismissal in localStorage to not show again for 7 days
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  useEffect(() => {
    // Check if user dismissed recently
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        setShowPrompt(false);
      }
    }
  }, []);

  if (isInstalled || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-50 animate-slide-up">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl shadow-2xl p-4 sm:p-5 border border-blue-400">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                <span className="text-2xl">📱</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold mb-1">Install App</h3>
              <p className="text-sm text-blue-100 mb-3">
                Install Qaretech Subscription Management for quick access and a better experience.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleInstallClick}
                  className="px-4 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors text-sm"
                >
                  Install Now
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-blue-500 bg-opacity-50 text-white rounded-lg font-medium hover:bg-opacity-70 transition-colors text-sm"
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="ml-2 text-white hover:text-blue-200 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <span className="text-xl">×</span>
          </button>
        </div>
      </div>
    </div>
  );
};


import { useEffect } from 'react';

// Extend Window interface for Sienna
declare global {
  interface Window {
    sienna?: {
      init: (config: { iconPosition?: string; primaryColor?: string }) => void;
    };
  }
}

const AccessibilityWidget = () => {
  useEffect(() => {
    const script = document.createElement('script');
    // Use the jsDelivr npm CDN as recommended by Sienna:
    // https://accessibility-widget.pages.dev/#setup
    script.src = 'https://cdn.jsdelivr.net/npm/sienna-accessibility@latest/dist/sienna-accessibility.umd.js';
    script.defer = true;

    script.onload = () => {
      if (window.sienna) {
        window.sienna.init({
          iconPosition: 'bottom-left',
          primaryColor: '#3b82f6' 
        });
      }
    };

    script.onerror = () => {
      console.warn('[MediVoice] Failed to load Sienna accessibility widget');
    };

    document.body.appendChild(script);

    return () => {
      // Safely remove script if it exists
      if (script.parentNode) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return null; // This component renders nothing itself
};

export default AccessibilityWidget;


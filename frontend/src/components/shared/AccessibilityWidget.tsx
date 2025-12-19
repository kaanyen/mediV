import { useEffect } from 'react';

const AccessibilityWidget = () => {
  useEffect(() => {
    const script = document.createElement('script');
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


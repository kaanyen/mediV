interface Window {
  sienna?: {
    init: (config?: {
      iconPosition?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
      primaryColor?: string;
      triggerId?: string;
    }) => void;
  };
}


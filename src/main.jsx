import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Log configuration source for debugging
function logConfigSource() {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 
                   import.meta.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  
  const extensionId = import.meta.env.VITE_EXTENSION_ID;
  
  if (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID) {
    console.log('✅ Using Project ID from VITE_WALLETCONNECT_PROJECT_ID');
  } else if (import.meta.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
    console.log('✅ Using Project ID from NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
  } else {
    console.error('❌ VITE_WALLETCONNECT_PROJECT_ID or NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required');
  }
  
  if (extensionId) {
    console.log('✅ Using Extension ID from VITE_EXTENSION_ID');
  } else {
    console.error('❌ VITE_EXTENSION_ID is required');
  }
}

// Initialize app
function init() {
  console.log('Initializing app...');
  
  // Log where config is coming from (for debugging)
  logConfigSource();
  
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('Root element not found');
    return;
  }
  
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  
  console.log('React app rendered successfully');
}

init();

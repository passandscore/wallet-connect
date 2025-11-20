import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Load environment variables from API if available
async function loadEnvironment() {
  try {
    const response = await fetch('/api/env.js');
    if (response.ok) {
      const script = await response.text();
      new Function(script)();
    }
  } catch (error) {
    console.warn('Could not load environment variables:', error);
  }
}

// Initialize configuration
function initializeConfig() {
  window.APP_CONFIG = {
    EXTENSION_ID: import.meta.env.VITE_EXTENSION_ID || 'obolaknhonmbgdcmfiihbdcenhhiiaao',
    PROJECT_ID: '',
  };

  const envProjectId = window.__ENV__?.WALLETCONNECT_PROJECT_ID || 
                       window.__ENV__?.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdFromUrl = urlParams.get('projectId');
  const projectIdFromStorage = localStorage.getItem('WALLETCONNECT_PROJECT_ID');
  
  if (envProjectId) {
    window.APP_CONFIG.PROJECT_ID = envProjectId;
    console.log('Using Project ID from environment variable');
  } else if (projectIdFromUrl) {
    window.APP_CONFIG.PROJECT_ID = projectIdFromUrl;
    localStorage.setItem('WALLETCONNECT_PROJECT_ID', projectIdFromUrl);
    console.log('Using Project ID from URL parameter');
  } else if (projectIdFromStorage) {
    window.APP_CONFIG.PROJECT_ID = projectIdFromStorage;
    console.log('Using Project ID from localStorage');
  } else {
    console.warn('No Project ID found. App may not work correctly.');
  }
}

// Initialize app
async function init() {
  console.log('Initializing app...');
  
  window.__ENV__ = window.__ENV__ || {};
  
  await Promise.race([
    loadEnvironment(),
    new Promise(resolve => setTimeout(resolve, 500))
  ]);
  
  initializeConfig();
  
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


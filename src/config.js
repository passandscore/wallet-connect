// Configuration helper functions
export const getExtensionId = () => {
  return window.APP_CONFIG?.EXTENSION_ID || import.meta.env.VITE_EXTENSION_ID || 'obolaknhonmbgdcmfiihbdcenhhiiaao';
};

export const getProjectId = () => {
  // Priority: 1. Environment variable (Vite), 2. window.APP_CONFIG, 3. URL param, 4. localStorage
  const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 
                       import.meta.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
                       window.APP_CONFIG?.PROJECT_ID ||
                       window.__ENV__?.WALLETCONNECT_PROJECT_ID ||
                       window.__ENV__?.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  
  if (envProjectId) {
    return envProjectId;
  }
  
  // Try URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdFromUrl = urlParams.get('projectId');
  if (projectIdFromUrl) {
    localStorage.setItem('WALLETCONNECT_PROJECT_ID', projectIdFromUrl);
    return projectIdFromUrl;
  }
  
  // Try localStorage
  return localStorage.getItem('WALLETCONNECT_PROJECT_ID') || '';
};

export const getMetadata = () => {
  return {
    name: 'FastRPC Gas Tank',
    description: 'FastRPC service to handle your gas payments',
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  };
};


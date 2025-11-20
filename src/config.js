// Configuration helper functions
// All configuration comes from environment variables only

export const getExtensionId = () => {
  // Vite environment variable (build-time)
  const extensionId = import.meta.env.VITE_EXTENSION_ID;
  
  if (!extensionId) {
    throw new Error(
      'VITE_EXTENSION_ID environment variable is required. ' +
      'Please set it in your .env file or Vercel project settings.'
    );
  }
  
  return extensionId;
};

export const getProjectId = () => {
  // 1. Vite environment variable (build-time) - Highest priority
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 
                   import.meta.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  
  if (!projectId) {
    throw new Error(
      'VITE_WALLETCONNECT_PROJECT_ID or NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ' +
      'environment variable is required. ' +
      'Please set it in your .env file or Vercel project settings.'
    );
  }
  
  return projectId;
};

export const getMetadata = () => {
  const origin = import.meta.env.VITE_APP_URL || 
                 import.meta.env.VITE_SITE_URL || 
                 (typeof location !== 'undefined' ? location.origin : 'https://example.com');
  
  return {
    name: 'FastRPC Gas Tank',
    description: 'FastRPC service to handle your gas payments',
    url: origin,
    icons: [`${origin}/favicon.ico`],
  };
};

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import SignClient from '@walletconnect/sign-client';
import * as Types from '@walletconnect/types';
import QRCode from 'qrcode';

// Get configuration
const EXTENSION_ID = window.APP_CONFIG?.EXTENSION_ID || 'obolaknhonmbgdcmfiihbdcenhhiiaao';
let PROJECT_ID = window.APP_CONFIG?.PROJECT_ID || '';

// If PROJECT_ID is not set, prompt user
if (!PROJECT_ID) {
  const envProjectId = prompt('Enter your WalletConnect Project ID:');
  if (envProjectId) {
    PROJECT_ID = envProjectId.trim();
  }
}

// WalletConnect Metadata
const getMetadata = () => {
  return {
    name: 'FastRPC Gas Tank',
    description: 'FastRPC service to handle your gas payments',
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  };
};

function WalletConnectPage() {
  const [qrCode, setQrCode] = useState(null);
  const [state, setState] = useState('initializing');
  const [error, setError] = useState(null);
  
  // Guard to prevent double initialization (React Strict Mode)
  const initialized = useRef(false);
  const connecting = useRef(false); // Guard to prevent multiple connect() calls
  const clientRef = useRef(null);
  const approvalPromiseRef = useRef(null);

  // Simplified session persistence check
  /**
   * @description Simplified persistence check - WalletConnect SignClient automatically
   * saves the session internally when the approval promise resolves. We just need a small
   * defensive wait before handing off to the extension.
   */
  async function forceSessionPersistence() {
    console.log('[Connect Page] Session approval resolved. WalletConnect has already saved it internally.');
    
    // Request persistent storage permission (helps prevent IndexedDB eviction)
    if ('storage' in navigator && 'persist' in navigator.storage) {
      const isPersisted = await navigator.storage.persist();
      console.log('[Connect Page] Persistent storage granted:', isPersisted);
    }
    
    // Small defensive wait to allow any pending IndexedDB writes to flush
    // The actual session is already saved by WalletConnect when approval() resolved
    await new Promise(resolve => setTimeout(resolve, 50));
    console.log('[Connect Page] Session persistence check complete.');
  }

  useEffect(() => {
    // 🛑 CRITICAL CHECK: Exit early if already initialized
    if (initialized.current) {
      return;
    }
    
    initialized.current = true;

    async function initWalletConnect() {
      try {
        // Validate Project ID before proceeding
        if (!PROJECT_ID || PROJECT_ID === '') {
          throw new Error('WalletConnect Project ID is missing. Please set PROJECT_ID in the configuration.');
        }

        setState('initializing');
        setError(null);
        setQrCode(null);

        // 1. Initialize WalletConnect client (only if not already initialized)
        let client = clientRef.current;
        if (!client) {
          client = await SignClient.init({
            projectId: PROJECT_ID,
            metadata: getMetadata(),
          });
          clientRef.current = client;
        }

        // 🛑 CRITICAL: Prevent multiple connect() calls which create multiple proposals
        if (connecting.current) {
          console.log('Connection already in progress, skipping duplicate connect() call');
          return;
        }
        connecting.current = true;

        // 2. Connect and get pairing URI
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            eip155: {
              methods: [
                'eth_sendTransaction',
                'personal_sign',
                'eth_signTypedData',
                'eth_signTransaction',
              ],
              chains: ['eip155:560048'],
              events: ['chainChanged', 'accountsChanged'],
            },
          },
        });

        if (!uri) {
          throw new Error('Failed to generate pairing URI');
        }

        // Store the approval promise in a ref so it persists across re-renders
        approvalPromiseRef.current = approval();

        // 3. Generate QR code
        const qrDataUrl = await QRCode.toDataURL(uri, {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
        
        setQrCode(qrDataUrl);
        setState('connecting');

        // 4. Wait for user to scan QR code and approve (using the stored promise)
        let session;
        try {
          session = await approvalPromiseRef.current;
        } catch (approvalErr) {
          // Handle approval errors (including proposal expiration) separately
          const approvalErrorMsg = approvalErr instanceof Error 
            ? approvalErr.message 
            : typeof approvalErr === 'string' 
            ? approvalErr 
            : String(approvalErr);
          const approvalErrorStr = approvalErrorMsg.toLowerCase();
          
          if (approvalErrorStr.includes('proposal expired') || approvalErrorStr.includes('expired')) {
            console.debug('Proposal expired during approval, resetting for retry');
            initialized.current = false;
            connecting.current = false;
            setState('initializing');
            setError(null);
            setQrCode(null);
            return;
          }
          // Re-throw other approval errors to be caught by outer catch
          throw approvalErr;
        }
        console.log('WalletConnect session established:', session);

        // Validate that the session includes the required chain
        const requiredChain = 'eip155:560048';
        const sessionChains = session.namespaces.eip155?.chains || [];
        const sessionAccounts = session.namespaces.eip155?.accounts || [];

        console.log('Session validation - Required chain:', requiredChain);
        console.log('Session validation - Session chains:', sessionChains);
        console.log('Session validation - Session accounts:', sessionAccounts);

        // Check if chain is in chains array
        const chainInChainsArray = sessionChains.includes(requiredChain);
        // Check if any account is on the required chain (format: eip155:chainId:address)
        const hasAccountOnChain = sessionAccounts.some((acc) => {
          const parts = acc.split(':');
          return parts.length >= 3 && parts[0] === 'eip155' && parts[1] === '560048';
        });

        const hasRequiredChain = chainInChainsArray || hasAccountOnChain;

        console.log('Session validation - Chain in chains array:', chainInChainsArray);
        console.log('Session validation - Has account on chain:', hasAccountOnChain);
        console.log('Session validation - Has required chain:', hasRequiredChain);

        if (!hasRequiredChain) {
          console.error('Session validation failed: Missing required chain eip155:560048');
          console.error('Session namespaces:', JSON.stringify(session.namespaces, null, 2));
          
          // Provide helpful error message
          const approvedChains = sessionChains.length > 0 
            ? sessionChains.join(', ') 
            : sessionAccounts.map((acc) => {
                const parts = acc.split(':');
                return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : 'unknown';
              }).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
          
          throw new Error(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
        }

        // 5. Force session persistence to IndexedDB before sending to extension
        console.log('[Connect Page] Forcing session persistence...');
        await forceSessionPersistence();

        // 6. Send and AWAIT Confirmation from Extension
        if (window.chrome && window.chrome.runtime) {
          
          // CRITICAL: We wrap the sendMessage call in a Promise to await the
          // Extension's response, which confirms the Background Script has saved the data.
          await new Promise((resolve, reject) => {
            if (!window.chrome?.runtime) {
              return reject(new Error('Chrome extension runtime not available.'));
            }
            window.chrome.runtime.sendMessage(
              EXTENSION_ID,
              {
                type: 'WALLET_CONNECTED',
                session: {
                  topic: session.topic,
                  namespaces: session.namespaces,
                  expiry: session.expiry,
                  // Include all necessary fields for background script to save
                },
              },
              // The callback function handles the response from the background script
              (response) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error(`Extension Runtime Error: ${chrome.runtime.lastError.message}`));
                }

                if (response && response.success) {
                  console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
                  
                  // CRITICAL: Request the Bridge Page to reload/re-initialize SignClient
                  // This ensures the bridge page loads the session from storage into its active memory
                  if (window.chrome && window.chrome.runtime) {
                    console.log('[Connect Page] Requesting bridge page to reload and re-initialize SignClient...');
                    window.chrome.runtime.sendMessage(
                      EXTENSION_ID,
                      { type: 'BRIDGE_FORCE_RELOAD' },
                      (bridgeResponse) => {
                        if (chrome.runtime.lastError) {
                          console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                          // Don't fail the whole connection if bridge reload fails
                          // The bridge will eventually load the session on its next init
                        } else if (bridgeResponse && bridgeResponse.success) {
                          console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                        } else {
                          console.warn('[Connect Page] Bridge reload response:', bridgeResponse);
                        }
                        // Continue to resolve the main connection process
                        resolve();
                      }
                    );
                  } else {
                    console.warn('[Connect Page] Chrome runtime not available for bridge reload');
                    resolve();
                  }
                } else {
                  console.error('[Connect Page] Extension failed to acknowledge save:', response?.error);
                  reject(new Error(response?.error || 'Extension failed to acknowledge session save.'));
                }
              }
            );
          });
          
          // Only if the Promise resolves (i.e., Background Script saved the data and bridge reloaded)
          setState('connected');
          
        } else {
          throw new Error('Chrome extension runtime not available.');
        }
      } catch (err) {
        // Handle various error formats (Error object, string, etc.)
        const errorMessage = err instanceof Error 
          ? err.message 
          : typeof err === 'string' 
          ? err 
          : String(err);
        const errorString = errorMessage.toLowerCase();
        
        // Silently handle "Proposal expired" errors - user can retry
        if (errorString.includes('proposal expired') || errorString.includes('expired')) {
          console.debug('Proposal expired, resetting for retry');
          initialized.current = false;
          connecting.current = false;
          setState('initializing');
          setError(null);
          setQrCode(null);
          // Don't log to console.error to avoid showing in UI
          return;
        }
        
        console.error('WalletConnect error:', err);
        setError(errorMessage);
        setState('error');
        // Reset flags on error so user can retry
        initialized.current = false;
        connecting.current = false;
      }
    }

    initWalletConnect();
    
    // Cleanup function for beforeunload event
    const handleBeforeUnload = (event) => {
      // Don't prevent close if we're in connected state (session already persisted)
      if (state === 'connected') {
        return; // Allow normal close
      }
      
      // If we have a session but haven't sent it yet, warn user
      if (clientRef.current) {
        const sessions = clientRef.current.session.getAll();
        // Check if we have sessions and state is not connected
        const isNotConnected = state !== 'connected';
        if (sessions.length > 0 && isNotConnected) {
          // Session exists but page is closing before connection completes
          event.preventDefault();
          event.returnValue = 'Session is being saved. Please wait...';
          return event.returnValue;
        }
      }
      
      // Normal cleanup for other states
      if (clientRef.current) {
        try {
          // Disconnect any active pairings (pending connection proposals)
          const pairings = clientRef.current.pairing.getAll({ active: true });
          pairings.forEach((pairing) => {
            try {
              clientRef.current?.core.pairing.disconnect({ topic: pairing.topic });
            } catch (err) {
              // Silently fail - pairing may already be disconnected
              console.debug('Pairing cleanup:', err);
            }
          });
          
          // Disconnect any active sessions
          const sessions = clientRef.current.session.getAll();
          sessions.forEach((session) => {
            try {
              clientRef.current?.disconnect({ 
                topic: session.topic, 
                reason: { 
                  code: 6000, 
                  message: 'User closed connection page' 
                } 
              });
            } catch (err) {
              // Silently fail - session may already be disconnected
              console.debug('Session cleanup:', err);
            }
          });
        } catch (err) {
          // Silently fail - client may not be fully initialized
          console.debug('WalletConnect cleanup error:', err);
        }
      }
    };

    // Register beforeunload event to clean up on tab close
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Cleanup on unmount
    return () => {
      // Remove beforeunload listener
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (clientRef.current) {
        try {
          // Clean up pairings and sessions on component unmount
          const pairings = clientRef.current.pairing.getAll({ active: true });
          pairings.forEach((pairing) => {
            try {
              clientRef.current?.core.pairing.disconnect({ topic: pairing.topic });
            } catch (err) {
              // Silently fail - pairing may already be disconnected
              console.debug('Pairing cleanup on unmount:', err);
            }
          });
          
          const sessions = clientRef.current.session.getAll();
          sessions.forEach((session) => {
            try {
              clientRef.current?.disconnect({ 
                topic: session.topic, 
                reason: { 
                  code: 6000, 
                  message: 'Component unmounted' 
                } 
              });
            } catch (err) {
              // Silently fail - session may already be disconnected
              console.debug('Session cleanup on unmount:', err);
            }
          });
        } catch (err) {
          // Silently fail - client may not be fully initialized
          console.debug('WalletConnect cleanup on unmount error:', err);
        }
      }
    };
  }, []);

  const [retryTrigger, setRetryTrigger] = useState(0);

  // Retry function for the error state button
  async function connectWallet() {
    // Reset all state and flags to allow retry
    initialized.current = false;
    connecting.current = false;
    clientRef.current = null;
    approvalPromiseRef.current = null;
    setState('initializing');
    setError(null);
    setQrCode(null);
    setRetryTrigger(prev => prev + 1);
  }

  // Separate effect for retry functionality
  useEffect(() => {
    if (retryTrigger === 0) return; // Skip on initial mount (handled by main effect)
    
    // Prevent double initialization
    if (initialized.current) {
      return;
    }
    
    initialized.current = true;

    async function initWalletConnect() {
      try {
        // Validate Project ID before proceeding
        if (!PROJECT_ID || PROJECT_ID === '') {
          throw new Error('WalletConnect Project ID is missing. Please set PROJECT_ID in the configuration.');
        }

        setState('initializing');
        setError(null);
        setQrCode(null);

        // 1. Initialize WalletConnect client
        let client = clientRef.current;
        if (!client) {
          client = await SignClient.init({
            projectId: PROJECT_ID,
            metadata: getMetadata(),
          });
          clientRef.current = client;
        }

        // 🛑 CRITICAL: Prevent multiple connect() calls which create multiple proposals
        if (connecting.current) {
          console.log('Connection already in progress, skipping duplicate connect() call');
          return;
        }
        connecting.current = true;

        // 2. Connect and get pairing URI
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            eip155: {
              methods: [
                'eth_sendTransaction',
                'personal_sign',
                'eth_signTypedData',
                'eth_signTransaction',
                'eth_getTransactionCount',
              ],
              chains: ['eip155:560048'],
              events: ['chainChanged', 'accountsChanged'],
            },
          },
        });

        if (!uri) {
          throw new Error('Failed to generate pairing URI');
        }

        // Store the approval promise in a ref so it persists across re-renders
        approvalPromiseRef.current = approval();

        // 3. Generate QR code
        const qrDataUrl = await QRCode.toDataURL(uri, {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
        
        setQrCode(qrDataUrl);
        setState('connecting');

        // 4. Wait for user to scan QR code and approve
        let session;
        try {
          session = await approvalPromiseRef.current;
        } catch (approvalErr) {
          // Handle approval errors (including proposal expiration) separately
          const approvalErrorMsg = approvalErr instanceof Error 
            ? approvalErr.message 
            : typeof approvalErr === 'string' 
            ? approvalErr 
            : String(approvalErr);
          const approvalErrorStr = approvalErrorMsg.toLowerCase();
          
          if (approvalErrorStr.includes('proposal expired') || approvalErrorStr.includes('expired')) {
            console.debug('Proposal expired during approval, resetting for retry');
            initialized.current = false;
            connecting.current = false;
            setState('initializing');
            setError(null);
            setQrCode(null);
            return;
          }
          // Re-throw other approval errors to be caught by outer catch
          throw approvalErr;
        }
        console.log('WalletConnect session established:', session);

        // Validate that the session includes the required chain
        const requiredChain = 'eip155:560048';
        const sessionChains = session.namespaces.eip155?.chains || [];
        const sessionAccounts = session.namespaces.eip155?.accounts || [];

        console.log('Session validation - Required chain:', requiredChain);
        console.log('Session validation - Session chains:', sessionChains);
        console.log('Session validation - Session accounts:', sessionAccounts);

        // Check if chain is in chains array
        const chainInChainsArray = sessionChains.includes(requiredChain);
        // Check if any account is on the required chain (format: eip155:chainId:address)
        const hasAccountOnChain = sessionAccounts.some((acc) => {
          const parts = acc.split(':');
          return parts.length >= 3 && parts[0] === 'eip155' && parts[1] === '560048';
        });

        const hasRequiredChain = chainInChainsArray || hasAccountOnChain;

        console.log('Session validation - Chain in chains array:', chainInChainsArray);
        console.log('Session validation - Has account on chain:', hasAccountOnChain);
        console.log('Session validation - Has required chain:', hasRequiredChain);

        if (!hasRequiredChain) {
          console.error('Session validation failed: Missing required chain eip155:560048');
          console.error('Session namespaces:', JSON.stringify(session.namespaces, null, 2));
          
          // Provide helpful error message
          const approvedChains = sessionChains.length > 0 
            ? sessionChains.join(', ') 
            : sessionAccounts.map((acc) => {
                const parts = acc.split(':');
                return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : 'unknown';
              }).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
          
          throw new Error(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
        }

        // 5. Force session persistence to IndexedDB before sending to extension
        console.log('[Connect Page] Forcing session persistence...');
        await forceSessionPersistence();

        // 6. Send and AWAIT Confirmation from Extension
        if (window.chrome && window.chrome.runtime) {
          
          // CRITICAL: We wrap the sendMessage call in a Promise to await the
          // Extension's response, which confirms the Background Script has saved the data.
          await new Promise((resolve, reject) => {
            if (!window.chrome?.runtime) {
              return reject(new Error('Chrome extension runtime not available.'));
            }
            window.chrome.runtime.sendMessage(
              EXTENSION_ID,
              {
                type: 'WALLET_CONNECTED',
                session: {
                  topic: session.topic,
                  namespaces: session.namespaces,
                  expiry: session.expiry,
                  // Include all necessary fields for background script to save
                },
              },
              // The callback function handles the response from the background script
              (response) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error(`Extension Runtime Error: ${chrome.runtime.lastError.message}`));
                }

                if (response && response.success) {
                  console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
                  
                  // CRITICAL: Request the Bridge Page to reload/re-initialize SignClient
                  // This ensures the bridge page loads the session from storage into its active memory
                  if (window.chrome && window.chrome.runtime) {
                    console.log('[Connect Page] Requesting bridge page to reload and re-initialize SignClient...');
                    window.chrome.runtime.sendMessage(
                      EXTENSION_ID,
                      { type: 'BRIDGE_FORCE_RELOAD' },
                      (bridgeResponse) => {
                        if (chrome.runtime.lastError) {
                          console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                          // Don't fail the whole connection if bridge reload fails
                          // The bridge will eventually load the session on its next init
                        } else if (bridgeResponse && bridgeResponse.success) {
                          console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                        } else {
                          console.warn('[Connect Page] Bridge reload response:', bridgeResponse);
                        }
                        // Continue to resolve the main connection process
                        resolve();
                      }
                    );
                  } else {
                    console.warn('[Connect Page] Chrome runtime not available for bridge reload');
                    resolve();
                  }
                } else {
                  console.error('[Connect Page] Extension failed to acknowledge save:', response?.error);
                  reject(new Error(response?.error || 'Extension failed to acknowledge session save.'));
                }
              }
            );
          });
          
          // Only if the Promise resolves (i.e., Background Script saved the data and bridge reloaded)
          setState('connected');
          
        } else {
          throw new Error('Chrome extension runtime not available.');
        }
      } catch (err) {
        // Handle various error formats (Error object, string, etc.)
        const errorMessage = err instanceof Error 
          ? err.message 
          : typeof err === 'string' 
          ? err 
          : String(err);
        const errorString = errorMessage.toLowerCase();
        
        // Silently handle "Proposal expired" errors - user can retry
        if (errorString.includes('proposal expired') || errorString.includes('expired')) {
          console.debug('Proposal expired, resetting for retry');
          initialized.current = false;
          connecting.current = false;
          setState('initializing');
          setError(null);
          setQrCode(null);
          // Don't log to console.error to avoid showing in UI
          return;
        }
        
        console.error('WalletConnect error:', err);
        setError(errorMessage);
        setState('error');
        initialized.current = false;
        connecting.current = false;
      }
    }

    initWalletConnect();
  }, [retryTrigger]);

  // Styles
  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0a0a',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '2rem',
    },
    content: {
      maxWidth: '600px',
      width: '100%',
      textAlign: 'center',
    },
    title: {
      fontSize: '2rem',
      fontWeight: 'bold',
      marginBottom: '1rem',
      color: '#ffffff',
    },
    description: {
      fontSize: '1.1rem',
      color: '#cccccc',
      marginBottom: '2rem',
      lineHeight: '1.6',
    },
    hint: {
      fontSize: '0.9rem',
      color: '#888888',
      marginTop: '1rem',
    },
    qrContainer: {
      margin: '2rem 0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    },
    qrCode: {
      maxWidth: '100%',
      width: '400px',
      height: '400px',
      borderRadius: '12px',
      backgroundColor: '#ffffff',
      padding: '1rem',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    },
    waitingText: {
      marginTop: '1.5rem',
      color: '#53ffb2',
      fontSize: '1rem',
    },
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1rem',
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #333333',
      borderTop: '4px solid #53ffb2',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    },
    loadingText: {
      color: '#888888',
      fontSize: '1rem',
    },
    successIcon: {
      fontSize: '4rem',
      marginBottom: '1rem',
    },
    errorIcon: {
      fontSize: '4rem',
      marginBottom: '1rem',
    },
    errorText: {
      color: '#ff6b6b',
      fontSize: '1rem',
      marginBottom: '2rem',
      lineHeight: '1.6',
    },
    button: {
      backgroundColor: '#53ffb2',
      color: '#000000',
      border: 'none',
      padding: '12px 24px',
      fontSize: '1rem',
      fontWeight: 'bold',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
    },
  };

  // Success state
  if (state === 'connected') {
    return React.createElement('div', { style: styles.container },
      React.createElement('div', { style: styles.content },
        React.createElement('div', { style: styles.successIcon }, '✅'),
        React.createElement('h1', { style: styles.title }, 'Wallet Connected!'),
        React.createElement('p', { style: styles.description },
          'Your wallet has been successfully connected to the FastRPC Gas Tank extension.'
        ),
        React.createElement('p', { style: styles.hint },
          '**Session persistence confirmed.** You can safely close this tab and return to the extension.'
        )
      )
    );
  }

  // Error state
  if (state === 'error') {
    return React.createElement('div', { style: styles.container },
      React.createElement('div', { style: styles.content },
        React.createElement('div', { style: styles.errorIcon }, '❌'),
        React.createElement('h1', { style: styles.title }, 'Connection Error'),
        React.createElement('p', { style: styles.errorText }, error || 'An unknown error occurred'),
        React.createElement('button', 
          { 
            onClick: connectWallet, 
            style: styles.button
          },
          'Try Again'
        )
      )
    );
  }

  // Loading/Connecting state
  return React.createElement('div', { style: styles.container },
    React.createElement('div', { style: styles.content },
      React.createElement('h1', { style: styles.title }, 'Connect Your Wallet'),
      React.createElement('p', { style: styles.description },
        'Scan the QR code with your mobile wallet or approve the connection in your desktop wallet.'
      ),
      
      state === 'initializing' && React.createElement('div', { style: styles.loadingContainer },
        React.createElement('div', { style: styles.spinner }),
        React.createElement('p', { style: styles.loadingText }, 'Generating QR code...')
      ),

      qrCode && state === 'connecting' && React.createElement('div', { style: styles.qrContainer },
        React.createElement('img', { 
          src: qrCode, 
          alt: 'WalletConnect QR Code', 
          style: styles.qrCode
        }),
        React.createElement('p', { style: styles.waitingText },
          'Waiting for connection...'
        )
      )
    )
  );
}

// Initialize the app
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(WalletConnectPage));

import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { getExtensionId, getProjectId, getMetadata } from './config';
import './App.css';

function App() {
  const [qrCode, setQrCode] = useState(null);
  const [state, setState] = useState('initializing');
  const [error, setError] = useState(null);
  
  const initialized = useRef(false);
  const connecting = useRef(false);
  const messageListenerRef = useRef(null);

  // Send INIT_WALLETCONNECT message to background worker
  async function initWalletConnect() {
    if (connecting.current) {
      console.log('Connection already in progress, skipping duplicate init');
      return;
    }

    connecting.current = true;
    setState('initializing');
    setError(null);
    setQrCode(null);

    try {
      let projectId, extensionId, metadata;
      try {
        projectId = getProjectId();
        extensionId = getExtensionId();
        metadata = getMetadata();
      } catch (configErr) {
        throw new Error(configErr.message || 'Configuration error');
      }

      if (!projectId || projectId === '') {
        throw new Error(
          'VITE_WALLETCONNECT_PROJECT_ID or NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ' +
          'environment variable is required. Please set it in your .env file or Vercel project settings.'
        );
      }

      // Check if chrome extension runtime is available
      if (!window.chrome?.runtime) {
        throw new Error('Chrome extension runtime not available. This app must run in a Chrome extension context.');
      }

      console.log('[Connect Page] Sending INIT_WALLETCONNECT message to background worker...');

      // Send INIT_WALLETCONNECT message to background worker
      // This will be relayed: Popup → Background Worker → OD Host → Sandboxed Bridge
      await new Promise((resolve, reject) => {
        window.chrome.runtime.sendMessage(
          extensionId,
          {
            type: 'INIT_WALLETCONNECT',
            payload: {
              projectId,
              metadata,
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
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(`Extension Runtime Error: ${chrome.runtime.lastError.message}`));
            }

            if (response && response.success) {
              console.log('[Connect Page] ✅ INIT_WALLETCONNECT message sent successfully');
              resolve();
            } else {
              reject(new Error(response?.error || 'Failed to initialize WalletConnect'));
            }
          }
        );
      });

      // The URI will come back via WC_URI_GENERATED message (handled by message listener)
      
    } catch (err) {
      const errorMessage = err instanceof Error 
        ? err.message 
        : typeof err === 'string' 
        ? err 
        : String(err);
      
      console.error('WalletConnect initialization error:', err);
      setError(errorMessage);
      setState('error');
      connecting.current = false;
    }
  }

  // Set up message listener for messages from background worker
  useEffect(() => {
    // Check if chrome extension runtime is available
    if (typeof window === 'undefined' || !window.chrome?.runtime) {
      console.warn('Chrome extension runtime not available - this app requires a Chrome extension context');
      setError('Chrome extension runtime not available. This app must run in a Chrome extension context.');
      setState('error');
      return;
    }

    const extensionId = getExtensionId();

    // Helper function to handle extension messages
    const handleExtensionMessage = (message) => {
      if (message.type === 'WC_URI_GENERATED') {
        const { uri } = message.payload;
        
        if (!uri) {
          console.error('[Connect Page] Received WC_URI_GENERATED but URI is missing');
          setError('Failed to generate connection URI');
          setState('error');
          connecting.current = false;
          return;
        }

        console.log('[Connect Page] ✅ Received URI from bridge, generating QR code...');

        // Generate QR code from the received URI
        QRCode.toDataURL(uri, {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        })
          .then((qrDataUrl) => {
            setQrCode(qrDataUrl);
            setState('connecting');
            console.log('[Connect Page] ✅ QR code generated and displayed');
          })
          .catch((err) => {
            console.error('[Connect Page] Failed to generate QR code:', err);
            setError('Failed to generate QR code');
            setState('error');
            connecting.current = false;
          });
      } else if (message.type === 'WC_SESSION_APPROVED') {
        const { session } = message.payload;
        
        console.log('[Connect Page] ✅ Session approved:', session);

        // Validate that the session includes the required chain
        const requiredChain = 'eip155:560048';
        const sessionChains = session.namespaces.eip155?.chains || [];
        const sessionAccounts = session.namespaces.eip155?.accounts || [];

        const chainInChainsArray = sessionChains.includes(requiredChain);
        const hasAccountOnChain = sessionAccounts.some((acc) => {
          const parts = acc.split(':');
          return parts.length >= 3 && parts[0] === 'eip155' && parts[1] === '560048';
        });

        const hasRequiredChain = chainInChainsArray || hasAccountOnChain;

        if (!hasRequiredChain) {
          const approvedChains = sessionChains.length > 0 
            ? sessionChains.join(', ') 
            : sessionAccounts.map((acc) => {
                const parts = acc.split(':');
                return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : 'unknown';
              }).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
          
          setError(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
          setState('error');
          connecting.current = false;
          return;
        }

        // Send session to background worker for persistence
        if (window.chrome?.runtime) {
          window.chrome.runtime.sendMessage(
            extensionId,
            {
              type: 'WALLET_CONNECTED',
              session: {
                topic: session.topic,
                namespaces: session.namespaces,
                expiry: session.expiry,
              },
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('[Connect Page] Failed to save session:', chrome.runtime.lastError.message);
                setError(`Failed to save session: ${chrome.runtime.lastError.message}`);
                setState('error');
                return;
              }

              if (response && response.success) {
                console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
                
                // Request bridge reload
                window.chrome.runtime.sendMessage(
                  extensionId,
                  { type: 'BRIDGE_FORCE_RELOAD' },
                  (bridgeResponse) => {
                    if (chrome.runtime.lastError) {
                      console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                    } else if (bridgeResponse && bridgeResponse.success) {
                      console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                    }
                    
                    setState('connected');
                    connecting.current = false;
                  }
                );
              } else {
                console.error('[Connect Page] Extension failed to acknowledge save:', response?.error);
                setError(response?.error || 'Extension failed to acknowledge session save.');
                setState('error');
                connecting.current = false;
              }
            }
          );
        }
      }
    };

    // Listen for messages via window.postMessage (from extension's content script injection)
    const windowMessageListener = (event) => {
      // Verify message is from extension (optional security check)
      if (event.data && (event.data.type === 'WC_URI_GENERATED' || event.data.type === 'WC_SESSION_APPROVED')) {
        console.log('[Connect Page] Received message via window.postMessage:', event.data);
        handleExtensionMessage(event.data);
      }
    };
    
    window.addEventListener('message', windowMessageListener);

    // Listen for messages from background worker (legacy support)
    const messageListener = (message, sender, sendResponse) => {
      console.log('[Connect Page] Received message:', message);

      if (message.type === 'WC_URI_GENERATED') {
        // Received URI from the triple-bridge
        const { uri } = message.payload;
        
        if (!uri) {
          console.error('[Connect Page] Received WC_URI_GENERATED but URI is missing');
          setError('Failed to generate connection URI');
          setState('error');
          connecting.current = false;
          return;
        }

        console.log('[Connect Page] ✅ Received URI from bridge, generating QR code...');

        // Generate QR code from the received URI
        QRCode.toDataURL(uri, {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        })
          .then((qrDataUrl) => {
            setQrCode(qrDataUrl);
            setState('connecting');
            console.log('[Connect Page] ✅ QR code generated and displayed');
          })
          .catch((err) => {
            console.error('[Connect Page] Failed to generate QR code:', err);
            setError('Failed to generate QR code');
            setState('error');
            connecting.current = false;
          });
      } else if (message.type === 'WC_SESSION_APPROVED') {
        // Session was approved by the wallet
        const { session } = message.payload;
        
        console.log('[Connect Page] ✅ Session approved:', session);

        // Validate that the session includes the required chain
        const requiredChain = 'eip155:560048';
        const sessionChains = session.namespaces.eip155?.chains || [];
        const sessionAccounts = session.namespaces.eip155?.accounts || [];

        const chainInChainsArray = sessionChains.includes(requiredChain);
        const hasAccountOnChain = sessionAccounts.some((acc) => {
          const parts = acc.split(':');
          return parts.length >= 3 && parts[0] === 'eip155' && parts[1] === '560048';
        });

        const hasRequiredChain = chainInChainsArray || hasAccountOnChain;

        if (!hasRequiredChain) {
          const approvedChains = sessionChains.length > 0 
            ? sessionChains.join(', ') 
            : sessionAccounts.map((acc) => {
                const parts = acc.split(':');
                return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : 'unknown';
              }).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
          
          setError(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
          setState('error');
          connecting.current = false;
          return;
        }

        // Send session to background worker for persistence
        window.chrome.runtime.sendMessage(
          extensionId,
          {
            type: 'WALLET_CONNECTED',
            session: {
              topic: session.topic,
              namespaces: session.namespaces,
              expiry: session.expiry,
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Connect Page] Failed to save session:', chrome.runtime.lastError.message);
              setError(`Failed to save session: ${chrome.runtime.lastError.message}`);
              setState('error');
              return;
            }

            if (response && response.success) {
              console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
              
              // Request bridge reload
              window.chrome.runtime.sendMessage(
                extensionId,
                { type: 'BRIDGE_FORCE_RELOAD' },
                (bridgeResponse) => {
                  if (chrome.runtime.lastError) {
                    console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                  } else if (bridgeResponse && bridgeResponse.success) {
                    console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                  }
                  
                  setState('connected');
                  connecting.current = false;
                }
              );
            } else {
              console.error('[Connect Page] Extension failed to acknowledge save:', response?.error);
              setError(response?.error || 'Extension failed to acknowledge session save.');
              setState('error');
              connecting.current = false;
            }
          }
        );
      } else if (message.type === 'WC_SESSION_REJECTED') {
        // Session was rejected or expired
        const { error: errorMsg } = message.payload;
        console.log('[Connect Page] Session rejected:', errorMsg);
        
        const errorString = (errorMsg || '').toLowerCase();
        if (errorString.includes('proposal expired') || errorString.includes('expired')) {
          console.debug('Proposal expired, resetting for retry');
          initialized.current = false;
          connecting.current = false;
          setState('initializing');
          setError(null);
          setQrCode(null);
        } else {
          setError(errorMsg || 'Connection was rejected');
          setState('error');
          connecting.current = false;
        }
      } else if (message.type === 'WC_ERROR') {
        // Error from the bridge
        const { error: errorMsg } = message.payload;
        console.error('[Connect Page] Error from bridge:', errorMsg);
        setError(errorMsg || 'An error occurred during connection');
        setState('error');
        connecting.current = false;
      }

      // Return true to indicate we will send a response asynchronously
      return true;
    };

    // Register message listener
    messageListenerRef.current = messageListener;
    if (window.chrome?.runtime?.onMessage) {
      window.chrome.runtime.onMessage.addListener(messageListener);
    } else {
      console.error('chrome.runtime.onMessage is not available');
      setError('Chrome extension runtime API not available. This app must run in a Chrome extension context.');
      setState('error');
      return;
    }

    console.log('[Connect Page] Message listeners registered (runtime + window.postMessage)');

    // Initialize WalletConnect on mount
    if (!initialized.current) {
      initialized.current = true;
      // Call initWalletConnect asynchronously to avoid blocking render
      setTimeout(() => {
        initWalletConnect().catch((err) => {
          console.error('Failed to initialize WalletConnect:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(errorMsg || 'Failed to initialize connection');
          setState('error');
          connecting.current = false;
        });
      }, 100);
    }

    // Cleanup
    return () => {
      if (messageListenerRef.current && window.chrome?.runtime) {
        window.chrome.runtime.onMessage.removeListener(messageListenerRef.current);
        console.log('[Connect Page] Message listener removed');
      }
      window.removeEventListener('message', windowMessageListener);
      console.log('[Connect Page] Window message listener removed');
    };
  }, []);

  // Retry function for the error state button
  async function connectWallet() {
    initialized.current = false;
    connecting.current = false;
    setState('initializing');
    setError(null);
    setQrCode(null);
    
    // Re-initialize
    await initWalletConnect();
  }

  if (state === 'connected') {
    return (
      <div className="container">
        <div className="content">
          <div className="success-icon">✅</div>
          <h1 className="title">Wallet Connected!</h1>
          <p className="description">
            Your wallet has been successfully connected to the FastRPC Gas Tank extension.
          </p>
          <p className="hint">
            **Session persistence confirmed.** You can safely close this tab and return to the extension.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="container">
        <div className="content">
          <div className="error-icon">❌</div>
          <h1 className="title">Connection Error</h1>
          <p className="error-text">{error || 'An unknown error occurred'}</p>
          <button onClick={connectWallet} className="button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="content">
        <h1 className="title">Connect Your Wallet</h1>
        <p className="description">
          Scan the QR code with your mobile wallet or approve the connection in your desktop wallet.
        </p>
        
        {state === 'initializing' && (
          <div className="loading-container">
            <div className="spinner"></div>
            <p className="loading-text">Initializing connection...</p>
          </div>
        )}

        {qrCode && state === 'connecting' && (
          <div className="qr-container">
            <img 
              src={qrCode} 
              alt="WalletConnect QR Code" 
              className="qr-code"
            />
            <p className="waiting-text">
              Waiting for connection...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

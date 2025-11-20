import { useState, useEffect, useRef } from 'react';
import SignClient from '@walletconnect/sign-client';
import QRCode from 'qrcode';
import { getExtensionId, getProjectId, getMetadata } from './config';
import './App.css';

function App() {
  const [qrCode, setQrCode] = useState(null);
  const [state, setState] = useState('initializing');
  const [error, setError] = useState(null);
  
  // Guard to prevent double initialization (React Strict Mode)
  const initialized = useRef(false);
  const connecting = useRef(false);
  const clientRef = useRef(null);
  const approvalPromiseRef = useRef(null);

  // Simplified session persistence check
  async function forceSessionPersistence() {
    console.log('[Connect Page] Session approval resolved. WalletConnect has already saved it internally.');
    
    if ('storage' in navigator && 'persist' in navigator.storage) {
      const isPersisted = await navigator.storage.persist();
      console.log('[Connect Page] Persistent storage granted:', isPersisted);
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
    console.log('[Connect Page] Session persistence check complete.');
  }

  useEffect(() => {
    if (initialized.current) {
      return;
    }
    
    initialized.current = true;

    async function initWalletConnect() {
      try {
        const currentProjectId = getProjectId();
        
        if (!currentProjectId || currentProjectId === '') {
          throw new Error('WalletConnect Project ID is missing. Please set VITE_WALLETCONNECT_PROJECT_ID or use URL parameter: ?projectId=YOUR_ID');
        }

        setState('initializing');
        setError(null);
        setQrCode(null);

        let client = clientRef.current;
        if (!client) {
          client = await SignClient.init({
            projectId: currentProjectId,
            metadata: getMetadata(),
          });
          clientRef.current = client;
        }

        if (connecting.current) {
          console.log('Connection already in progress, skipping duplicate connect() call');
          return;
        }
        connecting.current = true;

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

        approvalPromiseRef.current = approval();

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

        let session;
        try {
          session = await approvalPromiseRef.current;
        } catch (approvalErr) {
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
          throw approvalErr;
        }
        console.log('WalletConnect session established:', session);

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
          
          throw new Error(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
        }

        console.log('[Connect Page] Forcing session persistence...');
        await forceSessionPersistence();

        if (window.chrome && window.chrome.runtime) {
          await new Promise((resolve, reject) => {
            if (!window.chrome?.runtime) {
              return reject(new Error('Chrome extension runtime not available.'));
            }
            window.chrome.runtime.sendMessage(
              getExtensionId(),
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
                  return reject(new Error(`Extension Runtime Error: ${chrome.runtime.lastError.message}`));
                }

                if (response && response.success) {
                  console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
                  
                  if (window.chrome && window.chrome.runtime) {
                    console.log('[Connect Page] Requesting bridge page to reload and re-initialize SignClient...');
                    window.chrome.runtime.sendMessage(
                      getExtensionId(),
                      { type: 'BRIDGE_FORCE_RELOAD' },
                      (bridgeResponse) => {
                        if (chrome.runtime.lastError) {
                          console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                        } else if (bridgeResponse && bridgeResponse.success) {
                          console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                        } else {
                          console.warn('[Connect Page] Bridge reload response:', bridgeResponse);
                        }
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
          
          setState('connected');
        } else {
          throw new Error('Chrome extension runtime not available.');
        }
      } catch (err) {
        const errorMessage = err instanceof Error 
          ? err.message 
          : typeof err === 'string' 
          ? err 
          : String(err);
        const errorString = errorMessage.toLowerCase();
        
        if (errorString.includes('proposal expired') || errorString.includes('expired')) {
          console.debug('Proposal expired, resetting for retry');
          initialized.current = false;
          connecting.current = false;
          setState('initializing');
          setError(null);
          setQrCode(null);
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
    
    const handleBeforeUnload = (event) => {
      if (state === 'connected') {
        return;
      }
      
      if (clientRef.current) {
        const sessions = clientRef.current.session.getAll();
        const isNotConnected = state !== 'connected';
        if (sessions.length > 0 && isNotConnected) {
          event.preventDefault();
          event.returnValue = 'Session is being saved. Please wait...';
          return event.returnValue;
        }
      }
      
      if (clientRef.current) {
        try {
          const pairings = clientRef.current.pairing.getAll({ active: true });
          pairings.forEach((pairing) => {
            try {
              clientRef.current?.core.pairing.disconnect({ topic: pairing.topic });
            } catch (err) {
              console.debug('Pairing cleanup:', err);
            }
          });
          
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
              console.debug('Session cleanup:', err);
            }
          });
        } catch (err) {
          console.debug('WalletConnect cleanup error:', err);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (clientRef.current) {
        try {
          const pairings = clientRef.current.pairing.getAll({ active: true });
          pairings.forEach((pairing) => {
            try {
              clientRef.current?.core.pairing.disconnect({ topic: pairing.topic });
            } catch (err) {
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
              console.debug('Session cleanup on unmount:', err);
            }
          });
        } catch (err) {
          console.debug('WalletConnect cleanup on unmount error:', err);
        }
      }
    };
  }, [state]);

  const [retryTrigger, setRetryTrigger] = useState(0);

  async function connectWallet() {
    initialized.current = false;
    connecting.current = false;
    clientRef.current = null;
    approvalPromiseRef.current = null;
    setState('initializing');
    setError(null);
    setQrCode(null);
    setRetryTrigger(prev => prev + 1);
  }

  useEffect(() => {
    if (retryTrigger === 0) return;
    
    if (initialized.current) {
      return;
    }
    
    initialized.current = true;

    async function initWalletConnect() {
      try {
        const currentProjectId = getProjectId();
        
        if (!currentProjectId || currentProjectId === '') {
          throw new Error('WalletConnect Project ID is missing. Please set VITE_WALLETCONNECT_PROJECT_ID or use URL parameter: ?projectId=YOUR_ID');
        }

        setState('initializing');
        setError(null);
        setQrCode(null);

        let client = clientRef.current;
        if (!client) {
          client = await SignClient.init({
            projectId: currentProjectId,
            metadata: getMetadata(),
          });
          clientRef.current = client;
        }

        if (connecting.current) {
          console.log('Connection already in progress, skipping duplicate connect() call');
          return;
        }
        connecting.current = true;

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

        approvalPromiseRef.current = approval();

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

        let session;
        try {
          session = await approvalPromiseRef.current;
        } catch (approvalErr) {
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
          throw approvalErr;
        }
        console.log('WalletConnect session established:', session);

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
          
          throw new Error(
            `Wallet did not approve the Hoodi chain (eip155:560048). ` +
            `Your wallet approved: ${approvedChains || 'no chains'}. ` +
            `Please reconnect and ensure you approve ALL requested chains, or manually add the Hoodi network (Chain ID: 560048) to your wallet first.`
          );
        }

        console.log('[Connect Page] Forcing session persistence...');
        await forceSessionPersistence();

        if (window.chrome && window.chrome.runtime) {
          await new Promise((resolve, reject) => {
            if (!window.chrome?.runtime) {
              return reject(new Error('Chrome extension runtime not available.'));
            }
            window.chrome.runtime.sendMessage(
              getExtensionId(),
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
                  return reject(new Error(`Extension Runtime Error: ${chrome.runtime.lastError.message}`));
                }

                if (response && response.success) {
                  console.log('[Connect Page] ✅ Extension confirmed session save to chrome.storage.local.');
                  
                  if (window.chrome && window.chrome.runtime) {
                    console.log('[Connect Page] Requesting bridge page to reload and re-initialize SignClient...');
                    window.chrome.runtime.sendMessage(
                      getExtensionId(),
                      { type: 'BRIDGE_FORCE_RELOAD' },
                      (bridgeResponse) => {
                        if (chrome.runtime.lastError) {
                          console.warn('[Connect Page] Failed to force bridge reload:', chrome.runtime.lastError.message);
                        } else if (bridgeResponse && bridgeResponse.success) {
                          console.log('[Connect Page] ✅ Bridge page reloaded and SignClient re-initialized.');
                        } else {
                          console.warn('[Connect Page] Bridge reload response:', bridgeResponse);
                        }
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
          
          setState('connected');
        } else {
          throw new Error('Chrome extension runtime not available.');
        }
      } catch (err) {
        const errorMessage = err instanceof Error 
          ? err.message 
          : typeof err === 'string' 
          ? err 
          : String(err);
        const errorString = errorMessage.toLowerCase();
        
        if (errorString.includes('proposal expired') || errorString.includes('expired')) {
          console.debug('Proposal expired, resetting for retry');
          initialized.current = false;
          connecting.current = false;
          setState('initializing');
          setError(null);
          setQrCode(null);
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
            <p className="loading-text">Generating QR code...</p>
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


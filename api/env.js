// Vercel Serverless Function to inject environment variables
// This allows us to access Vercel environment variables on the client side

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return environment variables that should be exposed to the client
  // Only expose variables that are safe for client-side use
  const clientEnv = {
    WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 
                              process.env.WALLETCONNECT_PROJECT_ID || 
                              '',
  };

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

  // Return as a JavaScript file that sets window.__ENV__
  res.status(200).send(
    `window.__ENV__ = ${JSON.stringify(clientEnv)};`
  );
}


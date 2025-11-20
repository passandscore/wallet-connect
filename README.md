# FastRPC Gas Tank - Wallet Connect

Single Page Application for connecting wallets via WalletConnect.

## Deployment on Vercel

This project is ready to deploy on Vercel. Follow these steps:

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Vercel will automatically detect the project settings

### 3. Set Environment Variables

In your Vercel project settings, add the following environment variable:

- **Name**: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- **Value**: Your WalletConnect Project ID

You can also set:
- **Name**: `WALLETCONNECT_PROJECT_ID` (alternative name)

### 4. Deploy

Click "Deploy" and Vercel will build and deploy your application.

## Configuration

The WalletConnect Project ID can be set in three ways (in order of priority):

1. **Environment Variable** (Recommended for production)
   - Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in Vercel
   - Or set `WALLETCONNECT_PROJECT_ID` in Vercel

2. **URL Parameter**
   - Add `?projectId=YOUR_PROJECT_ID` to the URL
   - This will also save to localStorage for future visits

3. **localStorage**
   - Previously saved value from URL parameter

## Local Development

To run locally:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Or install serve globally
npm install -g serve
serve .
```

Then open `http://localhost:8000` in your browser.

## Project Structure

```
.
├── index.html          # Main HTML file
├── app.js             # React application
├── api/
│   └── env.js         # Serverless function for environment variables
├── vercel.json        # Vercel configuration
├── package.json       # Project metadata
└── README.md          # This file
```

## Features

- ✅ Single Page Application (no build step required)
- ✅ ES Modules with Import Maps
- ✅ WalletConnect integration
- ✅ QR Code generation
- ✅ Chrome Extension integration
- ✅ Session persistence
- ✅ Environment variable support for Vercel
- ✅ Responsive design

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

Requires ES Module support and Import Maps support.


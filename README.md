# FastRPC Gas Tank - Wallet Connect

React application for connecting wallets via WalletConnect, built with Vite.

## 🚀 Quick Start

### Install Dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will open at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## 📦 Deployment on Vercel

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
4. Vercel will automatically detect Vite and configure the build settings

### 3. Set Environment Variables

In your Vercel project settings → Environment Variables, add:

- **Name**: `VITE_WALLETCONNECT_PROJECT_ID`
- **Value**: Your WalletConnect Project ID

Optional:
- **Name**: `VITE_EXTENSION_ID`
- **Value**: Your Chrome extension ID (default: `obolaknhonmbgdcmfiihbdcenhhiiaao`)

### 4. Deploy

Click "Deploy" and Vercel will:
1. Install dependencies (`npm install`)
2. Build the project (`npm run build`)
3. Deploy the `dist/` folder

## ⚙️ Configuration

The WalletConnect Project ID can be set in multiple ways (in order of priority):

1. **Environment Variable** (Recommended for production)
   - Set `VITE_WALLETCONNECT_PROJECT_ID` in Vercel or `.env` file
   - Or set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (for compatibility)

2. **URL Parameter**
   - Add `?projectId=YOUR_PROJECT_ID` to the URL
   - This will also save to localStorage for future visits

3. **localStorage**
   - Previously saved value from URL parameter

## 📁 Project Structure

```
.
├── src/
│   ├── App.jsx          # Main React component
│   ├── App.css          # Component styles
│   ├── main.jsx         # Application entry point
│   └── config.js        # Configuration helpers
├── api/
│   └── env.js           # Serverless function for environment variables
├── index.html           # HTML template
├── vite.config.js      # Vite configuration
├── vercel.json         # Vercel deployment config
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## 🛠️ Tech Stack

- **React 18** - UI library
- **Vite** - Build tool and dev server
- **WalletConnect Sign Client** - Wallet connection
- **QRCode** - QR code generation

## ✨ Features

- ✅ Modern React with JSX
- ✅ Fast development with Vite HMR
- ✅ WalletConnect integration
- ✅ QR Code generation
- ✅ Chrome Extension integration
- ✅ Session persistence
- ✅ Environment variable support
- ✅ Responsive design
- ✅ Error handling and retry logic

## 🌐 Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## 📝 Environment Variables

Create a `.env` file in the root directory:

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
VITE_EXTENSION_ID=obolaknhonmbgdcmfiihbdcenhhiiaao
```

**Note**: Environment variables prefixed with `VITE_` are exposed to the client-side code.

## 🔧 Development Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

## 📄 License

MIT

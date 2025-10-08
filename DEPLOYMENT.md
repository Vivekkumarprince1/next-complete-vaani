# Socket.IO Server Deployment Guide

Since Vercel doesn't support long-lived Socket.IO servers, you need to deploy the Socket.IO server separately.

## Option 1: Deploy on Railway (Recommended)

1. Create a Railway account at https://railway.app
2. Connect your GitHub repository
3. Deploy the project
4. Set environment variables in Railway:
   - `FORCE_SOCKET_SERVER=true`
   - `NODE_ENV=production`
   - `PORT=3000` (or Railway's default)
   - `JWT_SECRET=your_jwt_secret`
   - `MONGO_URI=your_mongodb_uri`
   - `AZURE_SPEECH_KEY=your_azure_key`
   - `AZURE_SPEECH_REGION=your_region`
   - `AZURE_TRANSLATOR_KEY=your_translator_key`
   - `AZURE_TRANSLATOR_REGION=your_translator_region`
   - `ALLOW_ORIGIN=https://your-vercel-app.vercel.app`

5. Get the Railway URL (e.g., `https://your-app.up.railway.app`)

## Option 2: Deploy on Render

1. Create a Render account at https://render.com
2. Create a new Web Service
3. Connect your GitHub repo
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Set environment variables (same as above)
7. Deploy

## Option 3: Deploy on Heroku

1. Create a Heroku app
2. Connect your GitHub repo
3. Set environment variables in Heroku dashboard
4. Deploy

## After Deployment

1. Set `NEXT_PUBLIC_SOCKET_URL=https://your-socket-server-url` in Vercel environment variables
2. Update CORS in `server.js` to allow your Vercel domain
3. Redeploy your Vercel app

## Testing

Test that Socket.IO connects by checking browser console for connection success messages.
# Vaani - Next.js Video Calling & Chat AppThis is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).



A real-time video calling and chat application built with Next.js, featuring multilingual support, real-time translation, and WebRTC video calls.## Getting Started



## 🚀 FeaturesFirst, run the development server:



- **User Authentication**: JWT-based secure authentication system```bash

- **Real-time Chat**: Socket.IO powered instant messagingnpm run dev

- **Video Calling**: WebRTC-based peer-to-peer video calls# or

- **Multilingual Support**: Built-in translation for 20+ languagesyarn dev

- **Group Chats**: Create and manage group conversations# or

- **Online Status**: Real-time user presence indicatorspnpm dev

- **Responsive Design**: Optimized for desktop and mobile devices# or

- **Modern UI**: Built with Tailwind CSS for a sleek interfacebun dev

```

## 📋 Prerequisites

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

- Node.js (v18 or higher)

- MongoDB (local or Atlas)You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

- npm or yarn

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## 🛠️ Installation

## Learn More

1. **Install dependencies**

   ```bashTo learn more about Next.js, take a look at the following resources:

   npm install

   ```- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.

- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

2. **Configure environment variables**

   You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

   Edit `.env.local` file:

   ```env## Deploy on Vercel

   # Database

   MONGO_URI=mongodb://localhost:27017/vaaniThe easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.


   JWT_SECRET=your_strong_jwt_secret_here

   # API URL
   NEXT_PUBLIC_API_URL=/api

   # Socket.IO Server (if separate server)
   NEXT_PUBLIC_SOCKET_URL=http://localhost:2000
   ```
   ```bash
   # For local MongoDB
   mongod
### Development Mode
```bash
npm run dev
```

- This project uses a custom server (`server.js`) that runs Next.js and a Socket.IO server. The `dev` script runs `node server.js`.
- Environment variables are loaded from `.env.local`. Make sure to copy `.env.example` to `.env.local` and fill the required values (MongoDB URI, Azure keys, JWT secret).
### Production Build
```bash

   ## Speech pipeline (Azure) - notes

   This repository includes a server-side speech pipeline that performs speech-to-text and translation using Azure Cognitive Services.

   - Files of interest:
      - `next/server/utils/speechToTextModule.js` - centralized STT implementation using Microsoft Speech SDK
      - `next/server/utils/speechTranslator.js` - orchestrates STT + Translator and exposes helper functions used by Socket handlers
      - `next/server/utils/textToSpeechModule.js` - TTS helper (used only in some flows)

   - Required environment variables (add to `.env.local` in development):
      - `AZURE_SPEECH_KEY` - your Azure Speech subscription key
      - `AZURE_SPEECH_REGION` - region (e.g. `eastus`)
      - `AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` - for text translation

   The pipeline is configured for "text-only" translation by default in many flows (speech recognition -> translate -> client-side TTS). If you want server-side TTS, the project includes `textToSpeechModule.js` which writes a small WAV file and returns the buffer.

   When testing locally, avoid committing keys to the repo; use `.env.local` or platform secrets in production.
npm run build
npm start
```

## 📁 Project Structure

```
next/
├── app/                  # Next.js App Router
│   ├── api/             # API Routes (Backend)
│   ├── dashboard/       # Dashboard page
│   ├── login/           # Login page
│   └── register/        # Register page
├── lib/                 # Server-side utilities
│   ├── db.js           # MongoDB connection
│   ├── auth.js         # Auth middleware
│   └── models/         # Mongoose models
├── src/
│   ├── components/     # React components
│   ├── contexts/       # React contexts
│   └── utils/          # Client utilities
└── public/             # Static files
```

## 🔑 API Endpoints

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `GET /api/auth/users` - Get all users

### Chat
- `GET /api/chat/history` - Get messages
- `POST /api/chat/message` - Send message
- `POST /api/chat/translate` - Translate text

## 🎨 Tech Stack

**Frontend:**
- Next.js 15 (App Router)
- React 19
- Tailwind CSS
- Socket.IO Client
- React Select

**Backend:**
- Next.js API Routes
- MongoDB + Mongoose
- JWT Authentication
- bcryptjs

**Real-time:**
- Socket.IO
- WebRTC

## 📱 Usage

1. Register/Login with username, mobile number, and password
2. Select a contact from the list
3. Start chatting in your preferred language
4. Initiate video calls with the call button

## 🚢 Deployment

Deploy to Vercel:
```bash
vercel
```

Or push to GitHub and connect to Vercel/Netlify.

## 🤝 Contributing

Contributions are welcome! Please submit a Pull Request.

## 📄 License

MIT License

---

Made with ❤️ using Next.js

## 🚀 Deploy to Render

This project uses a custom Node server (`server.js`) that starts Next.js and Socket.IO. For Render, we recommend adding the service via the `render.yaml` included in the repository and setting secrets in the Render Dashboard.

Quick steps

- Push your repo to GitHub (branch `main`).
- In Render, create a new Web Service and connect your repository, or import using `render.yaml`.
- Set these environment variables on the Render service (do NOT commit secrets to repo):
   - `MONGO_URI` or `MONGODB_URI` – MongoDB connection string (Atlas recommended)
   - `JWT_SECRET` – secret used to sign JWT tokens
   - `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (if using Azure speech)
   - `AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` (if using Azure translator)
   - `NEXT_PUBLIC_CLIENT_URL` – URL of client app (optional)
   - Any other envs listed in `.env.example`

Build & Start commands

- Build command: `npm install && npm run build`
- Start command: `npm run start`

Notes & troubleshooting

- Do not rely on `.env.local` in production — the server now only loads it in development.
- Ensure `NODE_ENV=production` is set by Render (it usually is by default).
- If the Socket.IO client cannot connect, check `NEXT_PUBLIC_SOCKET_URL` and CORS origins in Render.
- Check Render logs for `> Ready on http://` which indicates the server started.

### Out of memory (FATAL ERROR: Reached heap limit)

If you see a crash with "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" during build or at runtime, this means Node's V8 heap wasn't large enough for the Next.js build or server workload. Common mitigations on Render:

- Increase the V8 heap for build/start by setting NODE_OPTIONS, for example: `--max-old-space-size=4096`. The included `render.yaml` uses this value in build and start commands.
- Use a larger Render plan (more memory/CPU) if increasing the heap isn't sufficient.
- Pre-build the Next.js app in CI and push the `.next` build output into the repo or an artifact store so Render doesn't run a heavy build step.
- Reduce build-time memory usage by disabling unneeded plugins or removing huge static imports.

Example Render env var (in service dashboard)
- Key: `NODE_OPTIONS`
- Value: `--max-old-space-size=4096`

If you still face OOM errors, capture Render deploy logs and increase the value (e.g. 8192) or scale the instance.


# Deploying MediVoice to Vercel

## Overview

Your app has two parts:
- **Frontend**: React/Vite app (can deploy to Vercel)
- **Backend**: FastAPI Python app (needs different hosting)

## Option 1: Frontend on Vercel + Backend on Railway/Render (Recommended)

This is the easiest and most reliable approach.

### Step 1: Deploy Frontend to Vercel

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Deploy from frontend directory**:
   ```bash
   cd frontend
   vercel
   ```

3. **Set environment variable**:
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add: `VITE_API_BASE_URL` = `https://your-backend-url.railway.app` (or your backend URL)

### Step 2: Deploy Backend to Railway (Recommended) or Render

#### Railway (Easiest):

1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub
3. Select your repo and set root directory to `backend`
4. Railway will auto-detect Python and install dependencies
5. Add environment variables:
   - `GROQ_API_KEY` = your Groq API key
   - `GEMINI_API_KEY` = your Gemini API key (optional)
6. Railway will give you a URL like `https://your-app.railway.app`
7. Update `VITE_API_BASE_URL` in Vercel to point to this URL

#### Render (Alternative):

1. Go to [render.com](https://render.com)
2. New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables (same as Railway)
6. Get your URL and update Vercel

### Step 3: Update Frontend API URL

In `frontend/src/services/api.ts`, the API URL is already configured to use `VITE_API_BASE_URL` environment variable, which Vercel will inject during build.

## Option 2: Full Vercel Deployment (Advanced)

If you want everything on Vercel, you need to convert the FastAPI backend to serverless functions.

### Challenges:
- In-memory `DRUG_STORE` won't persist (need external database)
- FastAPI needs to be adapted for serverless
- More complex setup

### Quick Setup for Serverless:

1. Create `api/` directory in root
2. Convert FastAPI endpoints to Vercel serverless functions
3. Use external database (MongoDB Atlas, Supabase, etc.) for drug store

**Note**: This requires significant refactoring. Option 1 is recommended.

## Current Setup Notes

- **Frontend**: Uses PouchDB (browser-based) - works fine on Vercel
- **Backend**: Uses in-memory `DRUG_STORE` - won't persist on serverless
- **Database**: Patient/Encounter data is stored in browser (PouchDB) - no backend DB needed for that

## Recommended Architecture

```
Frontend (Vercel) → Backend API (Railway/Render) → External APIs (Groq, Gemini)
```

This gives you:
- ✅ Fast frontend delivery (Vercel CDN)
- ✅ Reliable backend (always-on server)
- ✅ Persistent data storage
- ✅ Easy scaling

## Quick Deploy Commands

### Frontend to Vercel:
```bash
cd frontend
vercel --prod
```

### Backend to Railway:
1. Push to GitHub
2. Connect Railway to repo
3. Set root to `backend/`
4. Add env vars
5. Deploy!

## Environment Variables Needed

**Frontend (Vercel)**:
- `VITE_API_BASE_URL` - Your backend URL

**Backend (Railway/Render)**:
- `GROQ_API_KEY` - Your Groq API key
- `GEMINI_API_KEY` - Optional, for Gemini fallback

## Need Help?

If you want me to set up the serverless version or help with Railway deployment, let me know!


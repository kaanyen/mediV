# Railway Deployment Guide for MediVoice Backend

## ✅ Your Backend is Ready!

Your backend is now configured for Railway deployment. Here's what I've set up:

### Files Created/Updated:
1. ✅ `backend/Procfile` - Tells Railway how to start your app
2. ✅ `backend/railway.json` - Railway configuration
3. ✅ `backend/main.py` - Updated to use `$PORT` environment variable
4. ✅ `backend/requirements.txt` - Added missing `google-generativeai` dependency

## 🚀 Quick Deployment Steps

### 1. Push to GitHub
Make sure all changes are committed and pushed:
```bash
git add .
git commit -m "Prepare for Railway deployment"
git push
```

### 2. Deploy on Railway

1. **Go to [railway.app](https://railway.app)** and sign up/login
2. **Click "New Project"** → **"Deploy from GitHub repo"**
3. **Select your repository** (`mediV`)
4. **Set Root Directory**: `backend`
5. **Railway will auto-detect** Python and install dependencies

### 3. Add Environment Variables

In Railway dashboard, go to your service → **Variables** tab, add:

```
GROQ_API_KEY=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
GEMINI_API_KEY=your_gemini_key_here (optional)
```

### 4. Get Your Backend URL

Railway will give you a URL like:
```
https://your-app-name.up.railway.app
```

### 5. Update Vercel

1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**
2. Update `VITE_API_BASE_URL` to your Railway URL:
   ```
   VITE_API_BASE_URL=https://your-app-name.up.railway.app
   ```
3. **Redeploy** your Vercel frontend (or it will auto-redeploy)

## 📋 What Railway Will Do Automatically

- ✅ Detect Python runtime
- ✅ Install dependencies from `requirements.txt`
- ✅ Use `Procfile` to start the app
- ✅ Provide `$PORT` environment variable
- ✅ Generate HTTPS URL
- ✅ Handle restarts on failure

## ⚠️ Important Notes

1. **Models Directory**: The `backend/models/` folder is large but won't be used (you're using cloud APIs). Railway might warn about size, but it's fine.

2. **Prescription Module**: The `prescription_module` is in the parent directory. Railway will need the root directory set correctly, or you may need to adjust the import path.

3. **Free Tier Limits**: Railway free tier has:
   - 500 hours/month compute time
   - $5 credit
   - Sleeps after inactivity (wakes on first request)

## 🧪 Test Your Deployment

Once deployed, test:
```bash
curl https://your-app-name.up.railway.app/health
```

Should return: `{"status":"ok"}`

## 🎉 You're Done!

Your backend should now be live on Railway and your Vercel frontend will connect to it automatically!


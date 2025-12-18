# MediVoice — Live Demo Guide (Phase 5)

This guide is the end-to-end runbook for a **live demo** of MediVoice (Nurse → Doctor → Lab → Doctor → Discharge), including **PWA install** and **offline / backend-down resilience**.

---

## Prerequisites

### System requirements
- **Node.js**: 18+ (recommended: 20+)
- **Python**: 3.9+ (recommended: 3.10+)
- **Chrome**: latest (best MediaRecorder + PWA install experience)

### Backend prerequisites
- Ensure the following local model assets exist:
  - `backend/models/whisper-adapter/adapter_config.json`
  - `backend/models/whisper-adapter/adapter_model.safetensors`
  - Whisper base model directory is present (repo includes `backend/models/distil-large-v3/`)
  - MedGemma local directory is present (repo includes `backend/models/medgemma-4b-it/`)
- If using Hugging Face gated models, export a token:
  - `export HF_TOKEN="..."` (or `HUGGINGFACE_HUB_TOKEN`)

### Mobile demo (optional)
- Install **ngrok** (or Cloudflare Tunnel)

---

## Startup Sequence (Full Stack)

### Command 1 — Start Python Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Verify:
- Open `http://127.0.0.1:8000/health` → should return `{"status":"ok"}`
- Backend logs should show models loaded successfully.

### Command 2 — Start Frontend

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:
- `http://127.0.0.1:5173/`

### Command 3 — Start ngrok (mobile testing)

```bash
ngrok http 5173
```

Use the `https://...` URL on your phone.

---

## Demo Script (Suggested Flow)

### Step 1 — Nurse: New Patient + Vitals
1. Go to **Nurse** module: `/`
2. Click **New Entry** → **New Patient**
3. Enter:
   - Name: `Kwame`
   - Age: `25`
   - Sex: `male`
4. On Vitals screen:
   - Record audio (or type manually)
   - Click **Save & Send to Queue**
5. Verify **Kwame** appears under **Waiting for Consult**.

### Step 2 — Doctor: Differential Diagnosis + Order Labs
1. Go to **Doctor** module: `/doctor`
2. Click Kwame → Consultation room
3. Record symptoms (or type):
   - `Patient has severe headache, chills, and bitter taste in mouth.`
4. Click **Generate Differential Diagnosis**
5. Click **Order Labs & Proceed**
6. Select **Malaria RDT** and submit
7. Verify Kwame disappears from Doctor queue (moved to lab).

### Step 3 — Lab: Enter Results
1. Go to **Lab** module: `/lab`
2. Select Kwame in lab queue
3. Enter result:
   - **Malaria RDT**: `Positive`
4. Submit results
5. Verify Kwame disappears from lab queue (moved to results_ready).

### Step 4 — Doctor: Second Opinion + Discharge
1. Return to `/doctor`
2. Verify Kwame appears with **Results Ready** tag
3. Open chart (Post-lab view)
4. Verify AI confirmation appears (based on positive RDT)
5. Click **Accept & Discharge**

### Step 5 — Nurse: Discharged Column
1. Return to `/`
2. Verify Kwame is in the **Discharged** column

---

## PWA Install (Add to Home Screen)

Important: service workers behave best in **production build** (not dev).

### Build + preview locally

```bash
cd frontend
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open:
- `http://127.0.0.1:4173/`

### Verify PWA
1. Open Chrome DevTools → **Application**
2. **Manifest**: verify no errors (name, icons, theme color)
3. **Service Workers**: verify registered
4. Browser URL bar should show **Install** icon (or use menu → “Install app”)

---

## Resilience / Offline Tests

### AI backend down (required)
1. Stop the Python backend (`Ctrl+C` in backend terminal)
2. In the frontend:
   - Try recording vitals or requesting diagnosis
3. Verify:
   - A toast appears: **“AI Server Disconnected / Offline”**
   - UI remains usable: nurses/doctors can continue with **manual entry** fields

### Simulate poor mobile connection
1. Chrome DevTools → Network → Throttling → **Slow 3G**
2. Navigate across `/`, `/doctor`, `/lab`
3. Verify the UI stays responsive and doesn’t crash.

---

## Troubleshooting

### Backend models won’t load / OOM / VRAM issues
- Restart backend:
  - Stop `uvicorn`, then run it again.
- Close other GPU-heavy apps.
- If download/auth issues occur:
  - Ensure `HF_TOKEN` is set and model terms are accepted.

### No microphone input / recording fails
- Use Chrome
- Allow microphone permission for the site
- Ensure you’re on `http://localhost` or an `https://` ngrok URL

### PWA install button missing
- Use `npm run build && npm run preview` (service worker + manifest in prod)
- Use HTTPS on mobile (ngrok)
- Confirm manifest icons are reachable under `/icons/...`




## MediVoice Demo Guide (Phase 5)

### Prerequisites
- **Node.js**: 18+ (recommended: current LTS)
- **Python**: 3.9+ (venv supported)
- **Chrome**: for MediaRecorder + PWA install demo
- **Optional**: `ngrok` for mobile testing

### Repo Layout
- **Backend**: `backend/` (FastAPI + local models)
- **Frontend**: `frontend/` (Vite React + PouchDB offline-first)

---

## Startup Sequence (Full Stack)

### 1) Start Python Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check:
- `GET http://localhost:8000/health` should return `{"status":"ok"}`

### 2) Start Frontend

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:
- Nurse module: `http://127.0.0.1:5173/`
- Doctor module: `http://127.0.0.1:5173/doctor`
- Lab module: `http://127.0.0.1:5173/lab`

### 3) Start ngrok (optional, mobile testing)

```bash
ngrok http 5173
```

Open the ngrok URL on your phone.

---

## Demo Script (Recommended Flow)

### Step 1: Nurse Dashboard (Offline-first)
1. Open Nurse dashboard (`/`).
2. Click **New Entry** → **New Patient**.
3. Create: **Kwame**, Age **25**, Sex **Male**.

### Step 2: Capture Vitals
1. On Vitals screen, click **Start Recording** and speak:
   - “Patient BP is 120 over 80, temperature 38, pulse 90, SpO2 97.”
2. Stop recording.
3. Show **Green Light** autofill (fields flash green) and that fields remain editable.
4. Click **Save & Send to Queue**.

### Step 3: Doctor Queue + Pre-Lab AI Diagnosis
1. Open Doctor dashboard (`/doctor`).
2. Click patient card → Consultation room.
3. Record symptoms (or type):
   - “Patient has severe headache, chills, and bitter taste in mouth.”
4. Click **Generate Differential Diagnosis**.
5. Highlight that AI suggests **Malaria** with high probability.

### Step 4: Lab Ordering
1. Click **Order Labs & Proceed**.
2. Select **Malaria RDT** and submit.
3. Show the patient moved to Lab Queue (`/lab`).

### Step 5: Lab Results Entry
1. In Lab dashboard (`/lab`), click the patient.
2. Enter **Malaria RDT: Positive**.
3. Submit results and show patient leaves lab queue and becomes **Results Ready** for doctor.

### Step 6: Doctor Second Opinion (Post-Lab Confirm)
1. Return to Doctor dashboard (`/doctor`).
2. Click the **Results Ready** patient.
3. Show comparison view and the AI **confirmation** logic.
4. Click **Accept & Discharge**.

### Step 7: Closed Loop (Final State)
1. Return to Nurse dashboard (`/`).
2. Show the patient in the **Discharged** column.

---

## PWA Demo (Installable App)
1. In Chrome, open DevTools → **Application** → **Manifest** and verify no errors.
2. Click the browser install prompt (“Install app”) or use Chrome menu → **Install MediVoice AI**.
3. Relaunch from desktop/home screen: confirm **standalone** mode (no URL bar).

---

## Resilience Demo (Backend Down)
1. Stop the Python backend (`Ctrl+C` in backend terminal).
2. Try recording vitals or symptoms.
3. Confirm:
   - A toast appears: **“AI Server Disconnected…”**
   - The UI stays usable and allows **manual entry**.

---

## Troubleshooting
- **Backend won’t start / model OOM**
  - Stop Uvicorn and restart:

```bash
uvicorn main:app --reload --port 8000
```

  - If using a large model, consider running on a machine with more RAM/VRAM.

- **PWA not installing**
  - Ensure you’re using Chrome and the Manifest tab shows no errors.
  - For a production-like install experience, run:

```bash
cd frontend
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

- **Offline cache weirdness**
  - DevTools → Application → Service Workers → “Unregister”
  - DevTools → Application → Storage → “Clear site data”



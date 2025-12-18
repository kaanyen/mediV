import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import DoctorHome from "./pages/DoctorHome";
import NurseHome from "./pages/NurseHome";
import PatientDatabase from "./pages/PatientDatabase";
import Consultation from "./pages/Consultation";
import VitalsCapture from "./pages/VitalsCapture";

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function AppShell() {
  const online = useOnlineStatus();
  const location = useLocation();
  const active = location.pathname.startsWith("/doctor") || location.pathname.startsWith("/consultation") ? "Doctor" : "Nurse";
  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-slate-900">MediVoice</div>
            <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{active} Module</div>
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                to="/"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Nurse" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Nurse
              </Link>
              <Link
                to="/doctor"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Doctor" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Doctor
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span
              className={[
                "inline-block h-2.5 w-2.5 rounded-full",
                online ? "bg-emerald-500" : "bg-slate-400"
              ].join(" ")}
              aria-label={online ? "Online" : "Offline"}
              title={online ? "Online" : "Offline"}
            />
            Sync Status: {online ? "Online" : "Offline"}
          </div>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<NurseHome />} />
        <Route path="/patients" element={<PatientDatabase />} />
        <Route path="/vitals/:patientId" element={<VitalsCapture />} />
        <Route path="/doctor" element={<DoctorHome />} />
        <Route path="/consultation/:id" element={<Consultation />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

/*
3.1 Backend Setup & Verification

- Place your adapter_config.json and adapter_model.safetensors files strictly into backend/models/whisper-adapter/.
- Navigate to backend/ and run: uvicorn main:app --reload --port 8000
- Verify: Check console logs to ensure both Whisper (with adapter) and MedGemma loaded successfully on the correct device.

3.2 Frontend Setup

- Navigate to frontend/ and run: npm install
- Then run: npm run dev
- Open localhost in Chrome (required for proper MediaRecorder support).

3.3 Functional Test

- Click the "Record" button.
- Speak a medical phrase with a Ghanaian accent: "Patient pressure is 140 over 90, temperature 38 degrees."
- Stop recording.

Observe:
- The "Processing..." spinner appears.
- The backend terminal shows the transcription log.
- The frontend updates with the exact text.
- The BP and Temp fields flash green and populate with 140/90 and 38.
*/

/*
Phase 2 Verification Guide

Test New Patient:
- Click FAB -> New Patient -> Enter "Kwame" -> Verify navigation to Vitals screen.

Test Voice Fill:
- Record audio. Verify form fields flash green. Manually change "Temp" from 37 to 38.

Test Queue:
- Click "Save". Redirect to Home. Verify "Kwame" appears in "Waiting for Consult" column.

Test Existing:
- Click FAB -> Select Existing -> Search "Kwame" -> Click row -> Verify new Vitals screen opens.
*/

/*
Phase 3 Verification Guide

Queue Check:
- Ensure the patient processed in Phase 2 ("Kwame") appears in the Doctor's Queue (/doctor).

AI Diagnosis:
- Open Consultation.
- Record Symptoms: "Patient has severe headache, chills, and bitter taste in mouth."
- Click "Generate Diagnosis".
- Verify: Backend logs the prompt. Frontend displays "Malaria" with high probability.

Lab Order:
- Click "Order Labs". Select "Malaria RDT".
- Submit.
- Verify: Patient disappears from Doctor Queue (moved to Lab status).
*/



import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import DoctorHome from "./pages/DoctorHome";
import LabDashboard from "./pages/LabDashboard";
import NurseHome from "./pages/NurseHome";
import PatientDatabase from "./pages/PatientDatabase";
import Consultation from "./pages/Consultation";
import PostLabConsult from "./pages/PostLabConsult";
import VitalsCapture from "./pages/VitalsCapture";

// Test API connectivity on app load (especially for mobile debugging)
function useApiConnectivityTest() {
  useEffect(() => {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
    console.log("[MediVoice] App loaded. Testing API connectivity to:", API_BASE_URL);
    
    // Direct fetch test (bypasses axios and service worker)
    fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
      cache: "no-store", // Force network request, bypass cache
    })
      .then((res) => {
        console.log("[MediVoice] Direct fetch test - Status:", res.status);
        return res.json();
      })
      .then((data) => {
        console.log("[MediVoice] Direct fetch test - Success:", data);
      })
      .catch((err) => {
        console.error("[MediVoice] Direct fetch test - Failed:", err);
        console.error("[MediVoice] Error details:", {
          message: err.message,
          name: err.name,
          stack: err.stack,
        });
      });
  }, []);
}

export default function App() {
  useApiConnectivityTest();
  
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<NurseHome />} />
          <Route path="/patients" element={<PatientDatabase />} />
          <Route path="/vitals/:patientId" element={<VitalsCapture />} />
          <Route path="/doctor" element={<DoctorHome />} />
          <Route path="/consultation/:id" element={<Consultation />} />
          <Route path="/post-lab/:id" element={<PostLabConsult />} />
          <Route path="/lab" element={<LabDashboard />} />
        </Routes>
      </AppShell>
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

/*
Phase 4 Verification Guide

Lab Workflow:
- Navigate to /lab (add this route to Router temporarily for testing).
- Select the patient from Phase 3 ("Kwame").
- Enter "Positive" for Malaria RDT. Submit.
- Verify patient disappears from Lab Queue.

Doctor Workflow:
- Return to Doctor Dashboard (/doctor).
- Verify "Kwame" is back with a "Results Ready" icon.
- Open chart.
- Verify AI Logic: Ensure the system calls /confirm-diagnosis and displays confirmation based on the positive test.
- Click "Accept & Discharge".

Final Check:
- Go to Nurse Dashboard (/).
- Verify "Kwame" is now in the "Discharged" column.
*/

/*
Phase 5 Verification (PWA + Resilience)

PWA Check:
- Open Chrome DevTools -> Application -> Manifest. Verify no errors.
- Check "Service Workers" is registered (Vite PWA plugin).

Offline / AI Down Check:
- Stop the Python server.
- Try to record audio.
- Verify a toast appears: "AI Server Disconnected" and the UI remains usable (manual entry).

Mobile Check:
- DevTools -> Network -> Throttling (Slow 3G). Verify UI remains responsive and no crashes.
*/



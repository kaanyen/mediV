import axios, { AxiosError } from "axios";
import { toast } from "../components/ui/toaster";

export type Vitals = {
  bp: string | null;
  temp: string | null;
  pulse: string | null;
  spo2: string | null;
};

export type VitalsResponse = {
  transcription: string;
  vitals: Vitals;
};

export type DiagnosisRequest = {
  symptoms: string;
  vitals: Record<string, unknown>;
  history?: string | null;
};

export type DiagnosisItem = {
  condition: string;
  probability: number;
  reasoning: string;
};

export type DiagnosisResponse = {
  diagnoses: DiagnosisItem[];
};

export type ConfirmDiagnosisRequest = {
  initial_diagnosis: Record<string, unknown>[];
  symptoms: string;
  lab_results: Record<string, string>;
};

export type ConfirmDiagnosisResponse = {
  final_diagnosis: DiagnosisItem[];
  analysis: string;
};

const API_BASE_URL = "https://subcollegiate-mamie-superbrave.ngrok-free.dev";

// Debug log (only in development)
if (import.meta.env.DEV) {
  console.log("[MediVoice] API Base URL:", API_BASE_URL);
}


const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    // CRITICAL: This header bypasses the Ngrok warning page on mobile
    "ngrok-skip-browser-warning": "true",
    "Content-Type": "application/json",
  }
});

let lastAiToastAt = 0;
function toastAiDisconnectedOnce() {
  const now = Date.now();
  if (now - lastAiToastAt < 4000) return;
  lastAiToastAt = now;
  const apiUrl = API_BASE_URL || "localhost:8000";
  toast({
    type: "error",
    title: "AI Server Disconnected",
    message: `Cannot reach backend at ${apiUrl}. Check ngrok/Vercel config.`
  });
}

api.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError) => {
    const isNetwork = err.code === "ERR_NETWORK" || (typeof err.message === "string" && /network/i.test(err.message));
    const status = err.response?.status;
    if (isNetwork || (status && status >= 500)) {
      toastAiDisconnectedOnce();
    }
    return Promise.reject(err);
  }
);

export async function processAudio(audioBlob: Blob): Promise<VitalsResponse | null> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");

  try {
    const res = await api.post<VitalsResponse>("/process-audio", formData, {
      headers: { 
        "Content-Type": "multipart/form-data",
        "ngrok-skip-browser-warning": "true", // Explicitly include for multipart requests
      }
    });
    return res.data;
  } catch (err) {
    console.error("[MediVoice] Audio processing failed:", err);
    return null;
  }
}

export async function extractVitals(transcription: string): Promise<VitalsResponse | null> {
  try {
    const res = await api.post<VitalsResponse>("/extract-vitals", {
      transcription: transcription.trim()
    });
    return res.data;
  } catch (err) {
    console.error("[MediVoice] Vital extraction failed:", err);
    return null;
  }
}

export async function getDiagnosis(data: DiagnosisRequest): Promise<DiagnosisResponse | null> {
  try {
    const res = await api.post<DiagnosisResponse>("/diagnose", data);
    return res.data;
  } catch {
    return null;
  }
}

export async function confirmDiagnosis(data: ConfirmDiagnosisRequest): Promise<ConfirmDiagnosisResponse | null> {
  try {
    const res = await api.post<ConfirmDiagnosisResponse>("/confirm-diagnosis", data);
    return res.data;
  } catch {
    return null;
  }
}



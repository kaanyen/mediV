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

// Use environment variable for API URL, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// Debug log (always log on mobile for troubleshooting)
console.log("[MediVoice] API Base URL:", API_BASE_URL);
console.log("[MediVoice] User Agent:", navigator.userAgent);

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

api.interceptors.request.use(
  (config) => {
    // Log all requests for debugging (especially on mobile)
    console.log("[MediVoice] API Request:", config.method?.toUpperCase(), config.url);
    const fullUrl = (config.baseURL || "") + (config.url || "");
    console.log("[MediVoice] Full URL:", fullUrl);
    return config;
  },
  (error) => {
    console.error("[MediVoice] Request interceptor error:", error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (resp) => {
    console.log("[MediVoice] API Response:", resp.status, resp.config.url);
    return resp;
  },
  (err: AxiosError) => {
    console.error("[MediVoice] API Error:", {
      url: err.config?.url,
      method: err.config?.method,
      status: err.response?.status,
      code: err.code,
      message: err.message,
    });
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

  const url = `${API_BASE_URL}/process-audio`;
  console.log("[MediVoice] Sending audio to:", url);
  console.log("[MediVoice] Audio blob size:", audioBlob.size, "bytes");

  try {
    const res = await api.post<VitalsResponse>("/process-audio", formData, {
      headers: { 
        "Content-Type": "multipart/form-data",
        "ngrok-skip-browser-warning": "true", // Explicitly include for multipart requests
      },
      timeout: 60000, // 60 second timeout for audio processing
    });
    console.log("[MediVoice] Audio processing success:", res.status);
    return res.data;
  } catch (err: any) {
    console.error("[MediVoice] Audio processing failed:", err);
    console.error("[MediVoice] Error details:", {
      message: err.message,
      code: err.code,
      response: err.response?.status,
      responseData: err.response?.data,
    });
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



import axios, { AxiosError } from "axios";
import { toast } from "../components/ui/toaster";

export type Vitals = {
  bp: string | null;
  temp: string | null;
  pulse: string | null;
  spo2: string | null;
  weight: string | null;
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
  detailed_reasoning?: string | null;
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// Debug log (only in development)
if (import.meta.env.DEV) {
  console.log("[MediVoice] API Base URL:", API_BASE_URL);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
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
    message: `Cannot reach backend at ${apiUrl}. Please check your backend server is running.`
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

export async function processTranscription(transcription: string): Promise<VitalsResponse | null> {
  try {
    const res = await api.post<VitalsResponse>("/process-audio", {
      transcription: transcription
    });
    return res.data;
  } catch (err) {
    console.error("[MediVoice] Transcription processing failed:", err);
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

export type PrescriptionItem = {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string | null;
  warnings?: string | null;
};

export type PrescriptionRequest = {
  condition: string;
  diagnosis: string;
  patient_weight?: string | null;
  allergies?: string | null;
  age?: string | null;
  other_conditions?: string | null;
};

export type PrescriptionResponse = {
  prescriptions: PrescriptionItem[];
  warnings?: string[] | null;
  notes?: string | null;
};

export async function getPrescription(data: PrescriptionRequest): Promise<PrescriptionResponse | null> {
  try {
    const res = await api.post<PrescriptionResponse>("/prescription", data);
    return res.data;
  } catch {
    return null;
  }
}

export type Drug = {
  _id: string;
  name: string;
  genericName?: string | null;
  category: string;
  dosageForm: string;
  strength: string;
  stock: number;
  unit: string;
  expiryDate?: string | null;
  supplier?: string | null;
  price?: number | null;
  createdAt: string;
};

export type DrugListResponse = {
  drugs: Drug[];
};

export type DrugCreateRequest = {
  name: string;
  genericName?: string | null;
  category: string;
  dosageForm: string;
  strength: string;
  stock: number;
  unit: string;
  expiryDate?: string | null;
  supplier?: string | null;
  price?: number | null;
};

export async function listDrugs(): Promise<DrugListResponse | null> {
  try {
    const res = await api.get<DrugListResponse>("/drugs");
    console.log("[API] listDrugs response:", res.data);
    return res.data;
  } catch (error) {
    console.error("[API] Error fetching drugs:", error);
    return null;
  }
}

export async function createDrug(data: DrugCreateRequest): Promise<Drug | null> {
  try {
    const res = await api.post<Drug>("/drugs", data);
    return res.data;
  } catch {
    return null;
  }
}

export async function updateDrug(drugId: string, data: DrugCreateRequest): Promise<Drug | null> {
  try {
    const res = await api.put<Drug>(`/drugs/${drugId}`, data);
    return res.data;
  } catch {
    return null;
  }
}

export async function deleteDrug(drugId: string): Promise<boolean> {
  try {
    await api.delete(`/drugs/${drugId}`);
    return true;
  } catch {
    return false;
  }
}

export async function searchDrugs(query: string): Promise<DrugListResponse | null> {
  try {
    const res = await api.get<DrugListResponse>("/drugs/search", { params: { q: query } });
    return res.data;
  } catch {
    return null;
  }
}



import axios from "axios";

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

const api = axios.create({
  baseURL: "http://localhost:8000"
});

export async function processAudio(audioBlob: Blob): Promise<VitalsResponse> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");

  const res = await api.post<VitalsResponse>("/process-audio", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return res.data;
}



export type EncounterStatus =
  | "waiting_for_consult"
  | "in_consult"
  | "waiting_for_lab"
  | "results_ready"
  | "discharged";

export interface Patient {
  _id: string; // UUID
  name: string;
  age: number;
  sex: "male" | "female";
  registeredAt: string;
}

export interface Encounter {
  _id: string;
  patientId: string;
  status: EncounterStatus;
  vitals?: {
    bp: string;
    temp: string;
    pulse: string;
    spo2: string;
    weight: string;
  };
  transcription?: string; // nurse vitals capture raw transcript
  symptoms?: string; // doctor consultation symptoms/HPI transcript
  initialDiagnosis?: { condition: string; probability: number; reasoning: string }[];
  finalDiagnosis?: { condition: string; probability: number; reasoning: string }[];
  finalAnalysis?: string;
  labs?: string[]; // Doctor lab requests
  labResults: Record<string, string>;
  createdAt: string;
  synced: boolean;
}



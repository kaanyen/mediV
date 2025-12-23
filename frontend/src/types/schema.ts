export type EncounterStatus =
  | "waiting_for_consult"
  | "in_consult"
  | "waiting_for_lab"
  | "results_ready"
  | "admitted"
  | "discharged"
  | "pharmacy";

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
  prescriptions?: Prescription[];
  admittedAt?: string;
  dischargedAt?: string;
  createdAt: string;
  synced: boolean;
}

export interface Prescription {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
  warnings?: string;
  prescribedAt: string;
  dispensed?: boolean;
}

export interface Drug {
  _id: string;
  name: string;
  genericName?: string;
  category: string;
  dosageForm: string; // e.g., "tablet", "syrup", "injection"
  strength: string; // e.g., "500mg", "10ml"
  stock: number;
  unit: string; // e.g., "tablets", "bottles", "vials"
  expiryDate?: string;
  supplier?: string;
  price?: number;
  createdAt: string;
}



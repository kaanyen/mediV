export type EncounterStatus =
  | "waiting_for_consult"
  | "in_consult"
  | "waiting_for_lab"
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
  transcription?: string; // The full raw text from voice
  createdAt: string;
  synced: boolean;
}



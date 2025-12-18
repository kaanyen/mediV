import PouchDB from "pouchdb-browser";
import PouchDBFind from "pouchdb-find";
import type { Encounter, EncounterStatus, Patient } from "../types/schema";
import { BackendAdapter } from "./backendAdapter";

PouchDB.plugin(PouchDBFind);

type PatientDoc = Patient & { type: "patient" };
type EncounterDoc = Encounter & { type: "encounter" };
type AnyDoc = PatientDoc | EncounterDoc;

const db = new PouchDB<AnyDoc>("medivoice_local");

let indexesReady: Promise<void> | null = null;

async function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      // Encounters by status (Kanban)
      await (db as any).createIndex({
        index: { fields: ["type", "status", "createdAt"] }
      });

      // Patients listing/search
      await (db as any).createIndex({
        index: { fields: ["type", "registeredAt"] }
      });
    })();
  }
  return indexesReady;
}

export function makeId(): string {
  // Browser-safe UUID (supported in modern Chrome/Edge/Safari).
  return crypto.randomUUID();
}

export async function addPatient(patient: Patient): Promise<Patient> {
  await ensureIndexes();
  const doc: PatientDoc = { ...patient, type: "patient" };
  await db.put(doc);
  await BackendAdapter.syncPatient(patient);
  return patient;
}

export async function createEncounter(encounter: Encounter): Promise<Encounter> {
  await ensureIndexes();
  const doc: EncounterDoc = { ...encounter, type: "encounter" };
  await db.put(doc);
  await BackendAdapter.syncEncounter(encounter);
  return encounter;
}

export async function getEncountersByStatus(status: EncounterStatus): Promise<Encounter[]> {
  await ensureIndexes();
  const res = await (db as any).find({
    selector: { type: "encounter", status },
    sort: [{ type: "asc" }, { status: "asc" }, { createdAt: "desc" }]
  });
  return (res.docs as EncounterDoc[]).map(({ type: _t, ...enc }) => enc);
}

export async function getAllPatients(): Promise<Patient[]> {
  await ensureIndexes();
  const res = await (db as any).find({
    selector: { type: "patient" },
    sort: [{ type: "asc" }, { registeredAt: "desc" }]
  });
  return (res.docs as PatientDoc[]).map(({ type: _t, ...p }) => p);
}

export async function getPatientById(patientId: string): Promise<Patient | null> {
  try {
    const doc = (await db.get(patientId)) as PatientDoc;
    if (doc.type !== "patient") return null;
    const { type: _t, ...p } = doc;
    return p;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}



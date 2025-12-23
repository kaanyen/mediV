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

async function updateEncounter(encounterId: string, patch: Partial<Encounter>): Promise<Encounter> {
  await ensureIndexes();
  const current = (await db.get(encounterId)) as any;
  if (!current || current.type !== "encounter") {
    throw new Error("Encounter not found");
  }
  const updated: any = { ...current, ...patch, synced: false };
  await db.put(updated);
  const { type: _t, _rev: _r, ...enc } = updated as EncounterDoc & { _rev?: string };
  await BackendAdapter.syncEncounter(enc as Encounter);
  return enc as Encounter;
}

export async function getEncounterById(encounterId: string): Promise<Encounter | null> {
  try {
    const doc = (await db.get(encounterId)) as any;
    if (!doc || doc.type !== "encounter") return null;
    const { type: _t, _rev: _r, ...enc } = doc as EncounterDoc & { _rev?: string };
    return enc;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function getEncountersByStatus(status: EncounterStatus): Promise<Encounter[]> {
  await ensureIndexes();
  const res = await (db as any).find({
    selector: { type: "encounter", status },
    sort: [{ type: "asc" }, { status: "asc" }, { createdAt: "desc" }]
  });
  return (res.docs as EncounterDoc[]).map(({ type: _t, ...enc }) => enc);
}

export async function getDoctorQueue(): Promise<Encounter[]> {
  // Phase 4: include results_ready, prioritized to the top.
  const [ready, waiting] = await Promise.all([
    getEncountersByStatus("results_ready"),
    getEncountersByStatus("waiting_for_consult")
  ]);
  return [...ready, ...waiting];
}

export async function updateEncounterToLab(encounterId: string, labRequest: string[]): Promise<Encounter> {
  return updateEncounter(encounterId, { status: "waiting_for_lab", labs: labRequest });
}

export async function getLabQueue(): Promise<Encounter[]> {
  return getEncountersByStatus("waiting_for_lab");
}

export async function submitLabResults(encounterId: string, results: Record<string, string>): Promise<Encounter> {
  return updateEncounter(encounterId, { status: "results_ready", labResults: results });
}

export async function saveInitialDiagnosis(
  encounterId: string,
  symptoms: string,
  initialDiagnosis: Encounter["initialDiagnosis"]
): Promise<Encounter> {
  return updateEncounter(encounterId, { symptoms, initialDiagnosis });
}

export async function admitEncounter(encounterId: string): Promise<Encounter> {
  return updateEncounter(encounterId, { 
    status: "admitted", 
    admittedAt: new Date().toISOString() 
  });
}

export async function sendToPharmacy(encounterId: string, prescriptions: Encounter["prescriptions"]): Promise<Encounter> {
  return updateEncounter(encounterId, { 
    status: "pharmacy", 
    prescriptions 
  });
}

export async function dischargeEncounter(
  encounterId: string,
  finalDiagnosis: Encounter["finalDiagnosis"],
  finalAnalysis: string
): Promise<Encounter> {
  return updateEncounter(encounterId, { 
    status: "discharged", 
    finalDiagnosis, 
    finalAnalysis,
    dischargedAt: new Date().toISOString()
  });
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



import type { Encounter, Patient } from "../types/schema";

export const BackendAdapter = {
  async syncPatient(p: Patient): Promise<void> {
    // Socket for future API integration.
    console.log("[FUTURE SYNC]: patient", p);
    return Promise.resolve();
  },

  async syncEncounter(e: Encounter): Promise<void> {
    // Socket for future API integration.
    console.log("[FUTURE SYNC]: encounter", e);
    return Promise.resolve();
  }
};



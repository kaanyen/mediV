import { useEffect, useMemo, useState } from "react";
import type { Encounter, Patient } from "../types/schema";
import { getAllPatients, getLabQueue, submitLabResults } from "../services/db";
import LabResultModal from "../components/LabResultModal";

function formatWait(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function LabDashboard() {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = async () => {
    const [queue, patients] = await Promise.all([getLabQueue(), getAllPatients()]);
    const map: Record<string, Patient> = {};
    for (const p of patients) map[p._id] = p;
    setPatientsById(map);
    setEncounters(queue);
  };

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    return encounters.map((e) => ({
      encounter: e,
      patient: patientsById[e.patientId]
    }));
  }, [encounters, patientsById]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <div className="text-sm font-semibold text-slate-500">Lab Queue</div>
        <h1 className="text-2xl font-semibold text-slate-900">Patients waiting for lab</h1>
        <div className="mt-1 text-sm text-slate-600">{rows.length} in queue</div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_1.2fr_0.5fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
          <div>Patient</div>
          <div>Requested Tests</div>
          <div>Time Waiting</div>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No patients in lab queue.</div>
          ) : (
            rows.map(({ encounter, patient }) => (
              <button
                key={encounter._id}
                onClick={() => {
                  setSelectedEncounterId(encounter._id);
                  setSelectedTests(encounter.labs ?? []);
                }}
                className="grid w-full grid-cols-[1fr_1.2fr_0.5fr] gap-3 px-4 py-4 text-left text-sm hover:bg-slate-50"
              >
                <div className="font-semibold text-slate-900 truncate">{patient?.name ?? "Unknown Patient"}</div>
                <div className="text-slate-700 truncate">{(encounter.labs ?? []).join(", ") || "—"}</div>
                <div className="text-slate-700 truncate">{formatWait(encounter.createdAt, nowTick)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <LabResultModal
        isOpen={Boolean(selectedEncounterId)}
        encounterId={selectedEncounterId}
        requestedTests={selectedTests}
        onClose={() => {
          setSelectedEncounterId(null);
          setSelectedTests([]);
        }}
        onSubmit={(results) => {
          if (!selectedEncounterId) return;
          void (async () => {
            await submitLabResults(selectedEncounterId, results);
            setSelectedEncounterId(null);
            setSelectedTests([]);
            await refresh();
          })();
        }}
      />
    </div>
  );
}



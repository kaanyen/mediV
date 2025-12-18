import { Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Encounter, Patient } from "../types/schema";
import { getAllPatients, getDoctorQueue } from "../services/db";

function parseTempC(temp: string | undefined | null): number | null {
  if (!temp) return null;
  const m = String(temp).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export default function DoctorHome() {
  const navigate = useNavigate();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});

  useEffect(() => {
    const run = async () => {
      const [queue, patients] = await Promise.all([getDoctorQueue(), getAllPatients()]);
      const map: Record<string, Patient> = {};
      for (const p of patients) map[p._id] = p;
      setPatientsById(map);
      setEncounters(queue);
    };
    void run();

    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const items = useMemo(() => {
    return encounters.map((e) => {
      const p = patientsById[e.patientId];
      const temp = parseTempC(e.vitals?.temp);
      return { encounter: e, patient: p, temp };
    });
  }, [encounters, patientsById]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Doctor's Queue</div>
          <h1 className="text-2xl font-semibold text-slate-900">Patients waiting for consultation</h1>
          <div className="mt-1 text-sm text-slate-600">{items.length} in queue</div>
        </div>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
            No patients waiting for consult.
          </div>
        ) : (
          items.map(({ encounter, patient, temp }) => (
            <button
              key={encounter._id}
              onClick={() => navigate(`/consultation/${encounter._id}`)}
              className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {patient?.name ?? "Unknown Patient"}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {patient ? `${patient.age} • ${patient.sex}` : "Patient details missing"}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600">Temp</div>
                  <div className={["text-sm font-semibold", temp !== null && temp > 38 ? "text-red-600" : "text-slate-900"].join(" ")}>
                    {encounter.vitals?.temp || "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600">BP</div>
                  <div className="text-sm font-semibold text-slate-900">{encounter.vitals?.bp || "—"}</div>
                </div>
                <div className="rounded-xl bg-slate-900 p-2 text-white">
                  <Stethoscope className="h-4 w-4" />
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}



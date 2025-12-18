import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Patient } from "../types/schema";
import { getAllPatients } from "../services/db";

export default function PatientDatabase() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectionMode = params.get("select") === "1";

  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const run = async () => {
      const all = await getAllPatients();
      setPatients(all);
    };
    void run();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => p.name.toLowerCase().includes(q) || p._id.toLowerCase().includes(q));
  }, [patients, query]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <div className="text-sm font-semibold text-slate-500">{selectionMode ? "Select Existing" : "Patient Database"}</div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {selectionMode ? "Select a patient" : "Patients"}
        </h1>
        {selectionMode && <div className="mt-1 text-sm text-slate-600">Click a patient to start a new vitals session.</div>}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name..."
          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1.2fr_0.5fr_0.5fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
          <div>Name</div>
          <div>Age</div>
          <div>Sex</div>
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No patients found.</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p._id}
                onClick={() => navigate(`/vitals/${p._id}`)}
                className="grid w-full grid-cols-[1.2fr_0.5fr_0.5fr] gap-3 px-4 py-4 text-left text-sm hover:bg-slate-50"
              >
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="text-slate-700">{p.age}</div>
                <div className="text-slate-700">{p.sex}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}



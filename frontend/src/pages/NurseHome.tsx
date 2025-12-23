import { Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Encounter, EncounterStatus, Patient } from "../types/schema";
import { addPatient, getAllPatients, getEncountersByStatus, makeId } from "../services/db";

type Column = {
  title: string;
  status: NurseColumnStatus;
};

type NurseColumnStatus = Exclude<EncounterStatus, "results_ready">;

const columns: Column[] = [
  { title: "Waiting for Consult", status: "waiting_for_consult" },
  { title: "In Consult", status: "in_consult" },
  { title: "Waiting for Lab", status: "waiting_for_lab" },
  { title: "Admitted", status: "admitted" },
  { title: "Pharmacy", status: "pharmacy" },
  { title: "Discharged", status: "discharged" }
];

const getColumnColor = (status: NurseColumnStatus): string => {
  if (status === "admitted") return "bg-red-50 border-red-200";
  if (status === "discharged") return "bg-emerald-50 border-emerald-200";
  if (status === "pharmacy") return "bg-blue-50 border-blue-200";
  return "bg-white border-slate-200";
};

const getColumnHeaderColor = (status: NurseColumnStatus): string => {
  if (status === "admitted") return "bg-red-100 text-red-900 border-red-200";
  if (status === "discharged") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (status === "pharmacy") return "bg-blue-100 text-blue-900 border-blue-200";
  return "bg-slate-50 text-slate-800 border-slate-100";
};

function minutesBetween(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

function formatWait(iso: string, now = Date.now()): string {
  const mins = minutesBetween(iso, now);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function NurseHome() {
  const navigate = useNavigate();

  const [encountersByStatus, setEncountersByStatus] = useState<Record<NurseColumnStatus, Encounter[]>>({
    waiting_for_consult: [],
    in_consult: [],
    waiting_for_lab: [],
    admitted: [],
    pharmacy: [],
    discharged: []
  });
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"choose" | "new_patient">("choose");
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState<number>(25);
  const [newSex, setNewSex] = useState<"male" | "female">("male");

  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = async () => {
    const [patients, waiting, inConsult, waitingLab, resultsReady, admitted, pharmacy, discharged] = await Promise.all([
      getAllPatients(),
      getEncountersByStatus("waiting_for_consult"),
      getEncountersByStatus("in_consult"),
      getEncountersByStatus("waiting_for_lab"),
      getEncountersByStatus("results_ready"),
      getEncountersByStatus("admitted"),
      getEncountersByStatus("pharmacy"),
      getEncountersByStatus("discharged")
    ]);

    const map: Record<string, Patient> = {};
    for (const p of patients) map[p._id] = p;
    setPatientsById(map);

    setEncountersByStatus({
      waiting_for_consult: waiting,
      in_consult: inConsult,
      // Treat results_ready as part of "Waiting for Lab"
      waiting_for_lab: [...resultsReady, ...waitingLab],
      admitted,
      pharmacy,
      discharged
    });
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

  const openNewEntry = () => {
    setNewName("");
    setNewAge(25);
    setNewSex("male");
    setModalStep("choose");
    setIsModalOpen(true);
  };

  const onCreatePatient = async () => {
    const name = newName.trim();
    if (!name) return;
    const patientId = makeId();
    const patient: Patient = {
      _id: patientId,
      name,
      age: Number.isFinite(newAge) ? newAge : 0,
      sex: newSex,
      registeredAt: new Date().toISOString()
    };
    await addPatient(patient);
    setIsModalOpen(false);
    navigate(`/vitals/${patientId}`);
  };

  const totalActive = useMemo(() => {
    return (
      encountersByStatus.waiting_for_consult.length +
      encountersByStatus.in_consult.length +
      encountersByStatus.waiting_for_lab.length +
      encountersByStatus.admitted.length +
      encountersByStatus.pharmacy.length +
      encountersByStatus.discharged.length
    );
  }, [encountersByStatus]);

  return (
    <div className="mx-auto max-w-[1920px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Active Sessions</div>
          <h1 className="text-2xl font-semibold text-slate-900">Nurse Workflow</h1>
          <div className="mt-1 text-sm text-slate-600">{totalActive} encounters in queue</div>
        </div>

        <button
          onClick={() => navigate("/patients")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        >
          <Users className="h-4 w-4" />
          Patient Database
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {columns.map((col) => {
          const encounters = encountersByStatus[col.status] ?? [];
          return (
            <div key={col.status} className={`rounded-2xl border ${getColumnColor(col.status)} min-w-0 flex flex-col`}>
              <div className={`flex items-center justify-between border-b px-3 py-2.5 ${getColumnHeaderColor(col.status)} shrink-0`}>
                <div className="text-xs font-semibold truncate flex-1 min-w-0">{col.title}</div>
                <div className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold shrink-0 ml-2">
                  {encounters.length}
                </div>
              </div>
              <div className="space-y-2 p-3 flex-1 min-h-0">
                {encounters.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-2 py-4 text-center text-xs text-slate-500">
                    No patients
                  </div>
                ) : (
                  encounters.map((enc) => {
                    const patient = patientsById[enc.patientId];
                    const name = patient?.name ?? "Unknown Patient";
                    const wait = formatWait(enc.createdAt, nowTick);
                    return (
                      <div
                        key={enc._id}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 shadow-sm min-w-0"
                      >
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">{name}</div>
                            <div className="mt-1 text-[10px] text-slate-600 break-words">Time: {wait}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={openNewEntry}
        className="fixed bottom-6 right-6 inline-flex items-center gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white shadow-xl hover:bg-slate-800"
      >
        <Plus className="h-5 w-5" />
        New Entry
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="text-sm font-semibold text-slate-500">Patient Selection</div>
              <div className="text-xl font-semibold text-slate-900">Start a new session</div>
            </div>

            <div className="px-6 py-5">
              {modalStep === "choose" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setModalStep("new_patient")}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left shadow-sm hover:bg-slate-50"
                  >
                    <div className="text-sm font-semibold text-slate-900">New Patient</div>
                    <div className="mt-1 text-sm text-slate-600">Register and capture vitals</div>
                  </button>

                  <button
                    onClick={() => {
                      setIsModalOpen(false);
                      navigate("/patients?select=1");
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left shadow-sm hover:bg-slate-50"
                  >
                    <div className="text-sm font-semibold text-slate-900">Select Existing</div>
                    <div className="mt-1 text-sm text-slate-600">Search patient database</div>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-slate-700">Name</div>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                        placeholder="e.g. Kwame"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium text-slate-700">Age</div>
                      <input
                        value={String(newAge)}
                        onChange={(e) => setNewAge(Number(e.target.value))}
                        type="number"
                        min={0}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-700">Sex</div>
                    <div className="flex gap-3">
                      <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                        <input
                          type="radio"
                          checked={newSex === "male"}
                          onChange={() => setNewSex("male")}
                        />
                        Male
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                        <input
                          type="radio"
                          checked={newSex === "female"}
                          onChange={() => setNewSex("female")}
                        />
                        Female
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => {
                  if (modalStep === "new_patient") setModalStep("choose");
                  else setIsModalOpen(false);
                }}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {modalStep === "new_patient" ? "Back" : "Cancel"}
              </button>

              {modalStep === "new_patient" && (
                <button
                  onClick={() => void onCreatePatient()}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Create & Continue
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



import { Loader2, ShieldCheck, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DiagnosisCard, { type Diagnosis } from "../components/DiagnosisCard";
import { confirmDiagnosis } from "../services/api";
import { dischargeEncounter, getEncounterById, getPatientById } from "../services/db";
import type { Encounter, Patient } from "../types/schema";

function labValueTone(v: string): "pos" | "neg" | "neutral" {
  const s = (v || "").toLowerCase();
  if (s.includes("positive") || s.includes("pos")) return "pos";
  if (s.includes("negative") || s.includes("neg")) return "neg";
  return "neutral";
}

export default function PostLabConsult() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isConfirming, setIsConfirming] = useState(false);
  const [analysis, setAnalysis] = useState<string>("");
  const [finalDx, setFinalDx] = useState<Diagnosis[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [symptomsInput, setSymptomsInput] = useState("");

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideText, setOverrideText] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      setLoadError(null);
      const enc = await getEncounterById(id);
      if (!enc) {
        setLoadError("Encounter not found.");
        setEncounter(null);
        setPatient(null);
        return;
      }
      setEncounter(enc);
      const p = await getPatientById(enc.patientId);
      setPatient(p);
      setSymptomsInput(enc.symptoms ?? "");
    };
    void run();
  }, [id]);

  useEffect(() => {
    const run = async () => {
      if (!id || !encounter) return;
      if (encounter.status !== "results_ready") return;
      if (!symptomsInput.trim()) return;

      setError(null);
      setIsConfirming(true);
      try {
        const res = await confirmDiagnosis({
          initial_diagnosis: (encounter.initialDiagnosis ?? []) as any,
          symptoms: symptomsInput,
          lab_results: encounter.labResults ?? {}
        });
        if (!res) {
          setError("AI Server Disconnected. You can still discharge or override manually.");
          setFinalDx(null);
          setAnalysis("");
          return;
        }
        setFinalDx((res.final_diagnosis ?? []) as Diagnosis[]);
        setAnalysis(res.analysis ?? "");
      } catch {
        setError("Confirmation failed. Ensure backend is running and /confirm-diagnosis is available.");
      } finally {
        setIsConfirming(false);
      }
    };
    void run();
  }, [encounter, id, symptomsInput]);

  const labEntries = useMemo(() => Object.entries(encounter?.labResults ?? {}), [encounter?.labResults]);

  const onDischarge = async () => {
    if (!id || !encounter) return;
    const useDx: Diagnosis[] =
      overrideText.trim().length > 0
        ? [{ condition: overrideText.trim(), probability: 1, reasoning: "Doctor override." }]
        : (finalDx ?? []);
    await dischargeEncounter(id, useDx, analysis || "Discharged after lab review.");
    navigate("/");
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-500">Post-Lab Consultation</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{loadError}</div>
          <div className="mt-4">
            <button
              onClick={() => navigate("/doctor")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Back to Doctor Queue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Post-Lab Consultation</div>
          <h1 className="text-2xl font-semibold text-slate-900">{patient?.name ?? "Patient"}</h1>
          <div className="mt-1 text-sm text-slate-600">
            {patient ? `${patient.age} • ${patient.sex}` : "Patient details missing"}
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Results Ready
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Before */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">Before (Pre-Lab)</div>
            <div className="text-xs font-semibold text-slate-500">Initial Symptoms</div>
            <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {encounter?.symptoms || "—"}
            </div>
            <div className="mt-3 text-xs font-semibold text-slate-500">Initial Diagnosis</div>
            <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {(encounter?.initialDiagnosis ?? []).length ? (
                <ul className="list-disc pl-5">
                  {(encounter?.initialDiagnosis ?? []).map((d, i) => (
                    <li key={`${d.condition}-${i}`}>
                      {d.condition} ({Math.round((d.probability ?? 0) * 100)}%)
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>

        {/* Center: Lab Results */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Stethoscope className="h-4 w-4" />
              New Data (Lab Results)
            </div>
            {labEntries.length === 0 ? (
              <div className="text-sm text-slate-600">No lab results recorded.</div>
            ) : (
              <div className="space-y-2">
                {labEntries.map(([k, v]) => {
                  const tone = labValueTone(v);
                  const cls =
                    tone === "pos"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : tone === "neg"
                        ? "border-slate-200 bg-slate-50 text-slate-800"
                        : "border-slate-200 bg-white text-slate-800";
                  return (
                    <div key={k} className={["rounded-xl border px-3 py-2 text-sm", cls].join(" ")}>
                      <span className="font-semibold">{k}:</span> <span className="font-semibold">{String(v)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Analysis */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">AI Analysis (Post-Lab)</div>
            {isConfirming ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirming diagnosis...
              </div>
            ) : error ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : (
              <>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{analysis || "—"}</div>
                {finalDx && <div className="mt-3"><DiagnosisCard diagnoses={finalDx} /></div>}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">Final Decision</div>
            {!symptomsInput.trim() && (
              <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Missing pre-lab symptoms on this encounter. Add symptoms below to run confirmation.
              </div>
            )}
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-700">Symptoms (for confirmation)</div>
              <textarea
                value={symptomsInput}
                onChange={(e) => setSymptomsInput(e.target.value)}
                className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
                placeholder='e.g. "severe headache, chills..."'
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void onDischarge()}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Accept & Discharge
              </button>
              <button
                onClick={() => setOverrideOpen((v) => !v)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Override
              </button>
            </div>
            {overrideOpen && (
              <div className="mt-3 space-y-1">
                <div className="text-sm font-medium text-slate-700">Override final diagnosis</div>
                <input
                  value={overrideText}
                  onChange={(e) => setOverrideText(e.target.value)}
                  placeholder='e.g. "Malaria Confirmed"'
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



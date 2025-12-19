import { ClipboardList, Loader2, Mic, Sparkles, Square, TestTubeDiagonal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DiagnosisCard, { type Diagnosis } from "../components/DiagnosisCard";
import LabRequestModal from "../components/LabRequestModal";
import VoiceVisualizer from "../components/VoiceVisualizer";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { getDiagnosis, processAudio } from "../services/api";
import { getEncounterById, getPatientById, saveInitialDiagnosis, updateEncounterToLab } from "../services/db";
import type { Encounter, Patient } from "../types/schema";

function vitalsLabel(v: Encounter["vitals"] | undefined) {
  if (!v) return "No vitals recorded.";
  const parts = [
    v.bp ? `BP ${v.bp}` : null,
    v.temp ? `Temp ${v.temp}` : null,
    v.pulse ? `Pulse ${v.pulse}` : null,
    v.spo2 ? `SpO₂ ${v.spo2}` : null,
    v.weight ? `Weight ${v.weight}` : null
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : "No vitals recorded.";
}

export default function Consultation() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { isRecording, audioBlob, mediaStream, startRecording, stopRecording } = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);

  const {
    supported: speechSupported,
    isListening,
    transcript: liveTranscript,
    interimTranscript,
    error: speechError,
    start: startSpeech,
    stop: stopSpeech,
    reset: resetSpeech
  } = useSpeechRecognition();

  const [symptoms, setSymptoms] = useState("");
  const [diagnoses, setDiagnoses] = useState<Diagnosis[] | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualDiagnosis, setManualDiagnosis] = useState("");

  const [labModalOpen, setLabModalOpen] = useState(false);

  const clearFlashTimeout = useRef<number | null>(null);
  const [flashSymptoms, setFlashSymptoms] = useState(false);

  const canRecord = useMemo(() => !isTranscribing && !isDiagnosing, [isDiagnosing, isTranscribing]);

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      setLoadError(null);
      const enc = await getEncounterById(id);
      if (!enc) {
        setEncounter(null);
        setPatient(null);
        setLoadError("Encounter not found.");
        return;
      }
      setEncounter(enc);
      const p = await getPatientById(enc.patientId);
      setPatient(p);
    };
    void run();
  }, [id]);

  const toggleRecording = async () => {
    setError(null);
    if (speechError) {
      resetSpeech();
    }
    if (!canRecord) return;

    if (isRecording) {
      stopRecording();
      if (speechSupported) {
        stopSpeech();
      }
      return;
    }

    try {
      resetSpeech();
      setSymptoms("");
      await startRecording();
      if (speechSupported) {
        startSpeech();
      }
    } catch {
      setError("Microphone access failed. Please allow microphone permissions in your browser.");
    }
  };

  // While recording, sync textarea with live Web Speech transcript
  useEffect(() => {
    if (!isRecording || !speechSupported) return;
    const combined = [liveTranscript, interimTranscript].filter(Boolean).join(" ").trim();
    if (combined) {
      setSymptoms(combined);
    }
  }, [isRecording, speechSupported, liveTranscript, interimTranscript]);

  useEffect(() => {
    if (!audioBlob) return;
    let cancelled = false;

    const run = async () => {
      setIsTranscribing(true);
      setError(null);
      try {
        const res = await processAudio(audioBlob);
        if (cancelled) return;
        if (!res) {
          setError("AI Server Disconnected. You can type symptoms manually.");
          return;
        }
        const next = res.transcription ?? "";
        setSymptoms(next);
        setFlashSymptoms(true);
        if (clearFlashTimeout.current) window.clearTimeout(clearFlashTimeout.current);
        clearFlashTimeout.current = window.setTimeout(() => setFlashSymptoms(false), 1200);
      } catch {
        if (cancelled) return;
        setError("Transcription failed. You can type symptoms manually.");
      } finally {
        if (!cancelled) setIsTranscribing(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [audioBlob]);

  const onDiagnose = async () => {
    if (!encounter) return;
    setError(null);
    setIsDiagnosing(true);
    try {
      const res = await getDiagnosis({
        symptoms,
        vitals: encounter.vitals ?? {}
      });
      if (!res) {
        setError("AI Server Disconnected. Use Manual Diagnosis below.");
        setDiagnoses(null);
        return;
      }
      const dx = (res.diagnoses ?? []) as Diagnosis[];
      setDiagnoses(dx);
      // Persist for Phase 4 "second opinion" workflow.
      if (id) {
        await saveInitialDiagnosis(id, symptoms, dx);
      }
    } catch {
      setError("Diagnosis failed. Use Manual Diagnosis below.");
    } finally {
      setIsDiagnosing(false);
    }
  };

  const onSubmitLabs = async (labs: string[]) => {
    if (!id) return;
    setLabModalOpen(false);
    await updateEncounterToLab(id, labs);
    navigate("/doctor");
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-500">Consultation</div>
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Consultation Room</div>
          <h1 className="text-2xl font-semibold text-slate-900">{patient?.name ?? "Patient"}</h1>
          <div className="mt-1 text-sm text-slate-600">{patient ? `${patient.age} • ${patient.sex}` : "Patient details missing"}</div>
        </div>
        <button
          onClick={toggleRecording}
          disabled={!canRecord}
          className={[
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-white shadow-sm transition",
            !canRecord ? "cursor-not-allowed bg-slate-400" : "",
            isRecording ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"
          ].join(" ")}
        >
          {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ClipboardList className="h-4 w-4" />
              Patient Context
            </div>
            <div className="text-sm text-slate-700">
              <span className="font-semibold">Vitals:</span> {vitalsLabel(encounter?.vitals)}
            </div>
          </div>

          <VoiceVisualizer mediaStream={mediaStream} isRecording={isRecording} />

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-slate-700">History of Present Illness / Symptoms</div>
                <div className="text-xs text-slate-600">
                  {speechSupported
                    ? isListening
                      ? "Live transcription (Web Speech) is capturing as you speak..."
                      : "Click record to start live transcription, or type symptoms manually."
                    : "Your browser does not support live speech recognition; audio will be transcribed after recording."}
                </div>
              </div>
              {(isTranscribing || isDiagnosing) && (
                <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isTranscribing ? "Transcribing..." : "Diagnosing..."}
                </div>
              )}
            </div>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder='Record or type symptoms, e.g. "severe headache, chills, bitter taste"...'
              className={[
                "h-40 w-full resize-none rounded-xl border px-3 py-2 text-sm text-slate-900 outline-none transition",
                flashSymptoms ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-slate-50"
              ].join(" ")}
            />
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {speechError && (
              <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Live transcription issue: {speechError}. You can still rely on backend transcription or type manually.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => void onDiagnose()}
            disabled={!symptoms.trim() || isDiagnosing}
            className={[
              "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition",
              !symptoms.trim() || isDiagnosing ? "cursor-not-allowed bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700"
            ].join(" ")}
          >
            <Sparkles className="h-4 w-4" />
            Generate Differential Diagnosis
          </button>

          {diagnoses ? <DiagnosisCard diagnoses={diagnoses} /> : null}

          {error && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-800">Manual Diagnosis</div>
              <div className="mt-1 text-sm text-slate-600">
                AI is unavailable. Enter your working diagnosis manually (for the demo).
              </div>
              <textarea
                value={manualDiagnosis}
                onChange={(e) => setManualDiagnosis(e.target.value)}
                className="mt-3 h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
                placeholder='e.g. "Suspected malaria; treat and await RDT"'
              />
            </div>
          )}

          <button
            onClick={() => setLabModalOpen(true)}
            disabled={!diagnoses || diagnoses.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            <TestTubeDiagonal className="h-4 w-4" />
            Order Labs & Proceed
          </button>
          {!diagnoses || diagnoses.length === 0 ? (
            <div className="text-xs text-slate-600">
              Generate and save the initial differential diagnosis before ordering labs.
            </div>
          ) : null}
        </div>
      </div>

      <LabRequestModal
        isOpen={labModalOpen}
        onClose={() => setLabModalOpen(false)}
        onSubmit={(labs) => void onSubmitLabs(labs)}
      />
    </div>
  );
}



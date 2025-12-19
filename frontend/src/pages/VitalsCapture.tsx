import { Loader2, Mic, Save, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AutoFillInput from "../components/AutoFillInput";
import VoiceVisualizer from "../components/VoiceVisualizer";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { processAudio, type VitalsResponse } from "../services/api";
import { createEncounter, getPatientById, makeId } from "../services/db";
import type { Encounter, Patient } from "../types/schema";

type VitalsState = {
  bp: string;
  temp: string;
  pulse: string;
  spo2: string;
  weight: string;
};

const emptyVitals: VitalsState = { bp: "", temp: "", pulse: "", spo2: "", weight: "" };

export default function VitalsCapture() {
  const navigate = useNavigate();
  const { patientId } = useParams<{ patientId: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientMissing, setPatientMissing] = useState(false);

  const { isRecording, audioBlob, mediaStream, startRecording, stopRecording } = useAudioRecorder();

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

  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [vitals, setVitals] = useState<VitalsState>(emptyVitals);
  const [aiFilled, setAiFilled] = useState<Record<keyof VitalsState, boolean>>({
    bp: false,
    temp: false,
    pulse: false,
    spo2: false,
    weight: false
  });
  const [error, setError] = useState<string | null>(null);
  const [transcriptionMode, setTranscriptionMode] = useState<"live" | "backend">(
    speechSupported ? "live" : "backend"
  );

  const clearFlashTimeout = useRef<number | null>(null);
  const canRecord = useMemo(() => !isProcessing, [isProcessing]);

  useEffect(() => {
    const run = async () => {
      if (!patientId) return;
      const p = await getPatientById(patientId);
      if (!p) {
        setPatient(null);
        setPatientMissing(true);
        return;
      }
      setPatient(p);
      setPatientMissing(false);
    };
    void run();
  }, [patientId]);

  const toggleRecording = async () => {
    setError(null);
    if (speechError) {
      // Clear previous speech errors when retrying
      resetSpeech();
    }
    if (!canRecord) return;

    if (isRecording) {
      stopRecording();
      if (speechSupported && transcriptionMode === "live") {
        stopSpeech();
      }
      return;
    }

    try {
      // Fresh live transcription for this recording
      resetSpeech();
      setTranscription("");
      await startRecording();
      if (speechSupported && transcriptionMode === "live") {
        startSpeech();
      }
    } catch {
      setError("Microphone access failed. Please allow microphone permissions in your browser.");
    }
  };

  // While recording, keep the textarea in sync with live Web Speech transcript (only in live mode)
  useEffect(() => {
    if (!isRecording || !speechSupported || transcriptionMode !== "live") return;
    const combined = [liveTranscript, interimTranscript].filter(Boolean).join(" ").trim();
    if (combined) {
      setTranscription(combined);
    }
  }, [isRecording, speechSupported, transcriptionMode, liveTranscript, interimTranscript]);

  useEffect(() => {
    if (!audioBlob) return;
    let cancelled = false;

    const run = async () => {
      setIsProcessing(true);
      setError(null);

      try {
        const res: VitalsResponse | null = await processAudio(audioBlob);
        if (cancelled) return;

        if (!res) {
          setError("AI Server Disconnected. You can still enter vitals manually.");
          return;
        }

        // In backend mode, replace transcription. In live mode, keep live transcript but update vitals
        if (transcriptionMode === "backend") {
          setTranscription(res.transcription ?? "");
        }
        
        setVitals((prev) => ({
          ...prev,
          bp: res.vitals?.bp ?? "",
          temp: res.vitals?.temp ?? "",
          pulse: res.vitals?.pulse ?? "",
          spo2: res.vitals?.spo2 ?? ""
        }));

        const nextFilled = {
          bp: Boolean(res.vitals?.bp),
          temp: Boolean(res.vitals?.temp),
          pulse: Boolean(res.vitals?.pulse),
          spo2: Boolean(res.vitals?.spo2),
          weight: false
        };
        setAiFilled(nextFilled);

        if (clearFlashTimeout.current) window.clearTimeout(clearFlashTimeout.current);
        clearFlashTimeout.current = window.setTimeout(() => {
          setAiFilled({ bp: false, temp: false, pulse: false, spo2: false, weight: false });
        }, 2000);
      } catch {
        if (cancelled) return;
        setError("Processing failed. You can still enter vitals manually.");
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [audioBlob, transcriptionMode]);

  const onSave = async () => {
    if (!patientId) return;
    setError(null);

    const encounter: Encounter = {
      _id: makeId(),
      patientId,
      status: "waiting_for_consult",
      vitals: { ...vitals },
      transcription,
      labResults: {},
      createdAt: new Date().toISOString(),
      synced: false
    };

    await createEncounter(encounter);
    navigate("/");
  };

  if (patientMissing) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-500">Vitals Capture</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">Patient not found</div>
          <div className="mt-2 text-sm text-slate-600">This patient ID does not exist in the local database.</div>
          <div className="mt-4">
            <button
              onClick={() => navigate("/patients")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Go to Patient Database
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Vitals Check</div>
          <h1 className="text-2xl font-semibold text-slate-900">Vitals Check: {patient?.name ?? "..."}</h1>
        </div>

        <div className="flex items-center gap-3">
          {speechSupported && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1">
              <button
                onClick={() => setTranscriptionMode("live")}
                disabled={isRecording}
                className={[
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  transcriptionMode === "live"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50",
                  isRecording ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
              >
                Live
              </button>
              <button
                onClick={() => setTranscriptionMode("backend")}
                disabled={isRecording}
                className={[
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  transcriptionMode === "backend"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50",
                  isRecording ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
              >
                Backend
              </button>
            </div>
          )}
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <VoiceVisualizer mediaStream={mediaStream} isRecording={isRecording} />

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Raw Transcription</div>
              <div className="flex items-center gap-3 text-xs text-slate-600">
                {transcriptionMode === "live" && speechSupported ? (
                  <span>{isListening ? "Live transcription (Web Speech) active..." : "Click record to start live transcription"}</span>
                ) : transcriptionMode === "backend" ? (
                  <span>Backend transcription (Whisper) will process after recording</span>
                ) : (
                  <span>Your browser does not support live speech recognition. Audio will be processed after recording.</span>
                )}
              </div>
              {isProcessing && (
                <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </div>
              )}
            </div>
            <textarea
              value={transcription}
              onChange={(e) => setTranscription(e.target.value)}
              placeholder="Transcription will appear here..."
              className="h-44 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
            />

            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {speechError && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Live transcription issue: {speechError}. You can still rely on backend transcription or type manually.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 text-sm font-semibold text-slate-700">Vitals Form</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <AutoFillInput
              label="Blood Pressure (bp)"
              value={vitals.bp}
              isAiFilled={aiFilled.bp}
              onChange={(bp) => setVitals((v) => ({ ...v, bp }))}
            />
            <AutoFillInput
              label="Temperature (temp)"
              value={vitals.temp}
              isAiFilled={aiFilled.temp}
              onChange={(temp) => setVitals((v) => ({ ...v, temp }))}
            />
            <AutoFillInput
              label="Pulse (pulse)"
              value={vitals.pulse}
              isAiFilled={aiFilled.pulse}
              onChange={(pulse) => setVitals((v) => ({ ...v, pulse }))}
            />
            <AutoFillInput
              label="SpO₂ (spo2)"
              value={vitals.spo2}
              isAiFilled={aiFilled.spo2}
              onChange={(spo2) => setVitals((v) => ({ ...v, spo2 }))}
            />
            <div className="sm:col-span-2">
              <AutoFillInput
                label="Weight (weight)"
                value={vitals.weight}
                isAiFilled={aiFilled.weight}
                onChange={(weight) => setVitals((v) => ({ ...v, weight }))}
              />
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={() => void onSave()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              <Save className="h-4 w-4" />
              Save & Send to Queue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



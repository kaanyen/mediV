import { Loader2, Mic, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "./components/layout/AppShell";
import AutoFillInput from "./components/AutoFillInput";
import VoiceVisualizer from "./components/VoiceVisualizer";
import { processAudio, type VitalsResponse } from "./services/api";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

type VitalsState = {
  bp: string;
  temp: string;
  pulse: string;
  spo2: string;
};

const emptyVitals: VitalsState = { bp: "", temp: "", pulse: "", spo2: "" };

export default function App() {
  const { isRecording, audioBlob, mediaStream, startRecording, stopRecording } = useAudioRecorder();

  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [vitals, setVitals] = useState<VitalsState>(emptyVitals);
  const [aiFilled, setAiFilled] = useState<Record<keyof VitalsState, boolean>>({
    bp: false,
    temp: false,
    pulse: false,
    spo2: false
  });
  const [error, setError] = useState<string | null>(null);

  const clearFlashTimeout = useRef<number | null>(null);

  const canRecord = useMemo(() => !isProcessing, [isProcessing]);

  const toggleRecording = async () => {
    setError(null);
    if (!canRecord) return;

    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      await startRecording();
    } catch (e) {
      setError("Microphone access failed. Please allow microphone permissions in your browser.");
    }
  };

  useEffect(() => {
    if (!audioBlob) return;

    let cancelled = false;

    const run = async () => {
      setIsProcessing(true);
      setError(null);

      try {
        const res: VitalsResponse = await processAudio(audioBlob);
        if (cancelled) return;

        setTranscription(res.transcription ?? "");
        setVitals({
          bp: res.vitals?.bp ?? "",
          temp: res.vitals?.temp ?? "",
          pulse: res.vitals?.pulse ?? "",
          spo2: res.vitals?.spo2 ?? ""
        });

        const nextFilled = {
          bp: Boolean(res.vitals?.bp),
          temp: Boolean(res.vitals?.temp),
          pulse: Boolean(res.vitals?.pulse),
          spo2: Boolean(res.vitals?.spo2)
        };
        setAiFilled(nextFilled);

        if (clearFlashTimeout.current) window.clearTimeout(clearFlashTimeout.current);
        clearFlashTimeout.current = window.setTimeout(() => {
          setAiFilled({ bp: false, temp: false, pulse: false, spo2: false });
        }, 2000);
      } catch (e: unknown) {
        if (cancelled) return;
        setError("Processing failed. Check the backend terminal logs for details.");
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [audioBlob]);

  return (
    <AppShell>
      <div className="min-h-full bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-500">MediVoice</div>
              <h1 className="text-2xl font-semibold text-slate-900">Vitals Capture</h1>
            </div>

            <button
              onClick={toggleRecording}
              disabled={!canRecord}
              className={[
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 font-medium text-white shadow-sm transition",
                !canRecord ? "cursor-not-allowed bg-slate-400" : "",
                isRecording ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"
              ].join(" ")}
            >
              {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {isRecording ? "Stop" : "Record"}
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-4">
              <VoiceVisualizer mediaStream={mediaStream} isRecording={isRecording} />

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-700">Transcript</div>
                  {isProcessing && (
                    <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </div>
                  )}
                </div>
                <textarea
                  readOnly
                  value={transcription}
                  placeholder="Your transcription will appear here..."
                  className="h-40 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
                />

                {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-4 text-sm font-semibold text-slate-700">Extracted Vitals</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <AutoFillInput label="Blood Pressure (bp)" value={vitals.bp} isAiFilled={aiFilled.bp} />
                <AutoFillInput label="Temperature (temp)" value={vitals.temp} isAiFilled={aiFilled.temp} />
                <AutoFillInput label="Pulse (pulse)" value={vitals.pulse} isAiFilled={aiFilled.pulse} />
                <AutoFillInput label="SpO₂ (spo2)" value={vitals.spo2} isAiFilled={aiFilled.spo2} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/*
3.1 Backend Setup & Verification

- Place your adapter_config.json and adapter_model.safetensors files strictly into backend/models/whisper-adapter/.
- Navigate to backend/ and run: uvicorn main:app --reload --port 8000
- Verify: Check console logs to ensure both Whisper (with adapter) and MedGemma loaded successfully on the correct device.

3.2 Frontend Setup

- Navigate to frontend/ and run: npm install
- Then run: npm run dev
- Open localhost in Chrome (required for proper MediaRecorder support).

3.3 Functional Test

- Click the "Record" button.
- Speak a medical phrase with a Ghanaian accent: "Patient pressure is 140 over 90, temperature 38 degrees."
- Stop recording.

Observe:
- The "Processing..." spinner appears.
- The backend terminal shows the transcription log.
- The frontend updates with the exact text.
- The BP and Temp fields flash green and populate with 140/90 and 38.
*/



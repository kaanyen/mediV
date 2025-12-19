import { useCallback, useRef, useState } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { isSpeechRecognitionSupported } from "../utils/speechRecognition";

type RecorderState = {
  isRecording: boolean;
  audioBlob: Blob | null;
  mediaStream: MediaStream | null;
  transcript: string; // From Web Speech API
  interimTranscript: string; // Real-time partial results
  useWebSpeech: boolean; // Whether Web Speech is being used
  startRecording: () => Promise<void>;
  stopRecording: () => void;
};

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useAudioRecorder(useWebSpeech: boolean = true): RecorderState {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");

  // Web Speech API integration
  const webSpeechSupported = isSpeechRecognitionSupported();
  const shouldUseWebSpeech = useWebSpeech && webSpeechSupported;
  const speechRecognition = useSpeechRecognition();

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    setAudioBlob(null);
    chunksRef.current = [];

    // Try Web Speech API first if enabled and supported
    if (shouldUseWebSpeech) {
      try {
        speechRecognition.start();
        setIsRecording(true);
        return;
      } catch (err) {
        console.warn("[useAudioRecorder] Web Speech failed, falling back to MediaRecorder", err);
        // Fall through to MediaRecorder
      }
    }

    // Fallback to MediaRecorder
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setMediaStream(stream);

      const mimeType = pickMimeType();
      mimeTypeRef.current = mimeType ?? "audio/webm";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) {
          chunksRef.current.push(evt.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        setAudioBlob(blob);
        setIsRecording(false);

        stream.getTracks().forEach((t) => t.stop());
        setMediaStream(null);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      throw err;
    }
  }, [isRecording, shouldUseWebSpeech, speechRecognition]);

  const stopRecording = useCallback(() => {
    if (shouldUseWebSpeech && speechRecognition.isListening) {
      speechRecognition.stop();
      setIsRecording(false);
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "inactive") return;
    recorder.stop();
  }, [shouldUseWebSpeech, speechRecognition]);

  // Determine recording state
  const actualIsRecording = shouldUseWebSpeech
    ? speechRecognition.isListening
    : isRecording;

  return {
    isRecording: actualIsRecording,
    audioBlob,
    mediaStream,
    transcript: speechRecognition.transcript,
    interimTranscript: speechRecognition.interimTranscript,
    useWebSpeech: shouldUseWebSpeech && actualIsRecording,
    startRecording,
    stopRecording,
  };
}



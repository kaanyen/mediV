import { useCallback, useRef, useState } from "react";

type RecorderState = {
  isRecording: boolean;
  audioBlob: Blob | null;
  mediaStream: MediaStream | null;
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

export function useAudioRecorder(): RecorderState {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef<string>("audio/webm");

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    setAudioBlob(null);
    chunksRef.current = [];

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
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  return { isRecording, audioBlob, mediaStream, startRecording, stopRecording };
}



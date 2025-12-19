import { useCallback, useEffect, useRef, useState } from "react";

type UseSpeechRecognitionState = {
  supported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
};

export function useSpeechRecognition(): UseSpeechRecognitionState {
  const [supported] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const w = window as any;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any | null>(null);

  useEffect(() => {
    if (!supported) return;
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      setTranscript("");
      setInterimTranscript("");
    };

    recognition.onerror = (evt: any) => {
      setError(evt?.error ?? "Speech recognition error");
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalText += res[0].transcript;
        } else {
          interimText += res[0].transcript;
        }
      }

      if (finalText) {
        setTranscript((prev) => (prev ? `${prev} ${finalText}` : finalText));
      }
      setInterimTranscript(interimText);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [supported]);

  const start = useCallback(() => {
    if (!supported) return;
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
    } catch {
      // start might throw if already started; ignore
    }
  }, [supported]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    supported,
    isListening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset
  };
}



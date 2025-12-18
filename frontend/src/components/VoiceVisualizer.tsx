import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  mediaStream: MediaStream | null;
  isRecording: boolean;
};

export default function VoiceVisualizer({ mediaStream, isRecording }: Props) {
  const bars = 8;
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: bars }, () => 0.12));

  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const idleLevels = useMemo(() => [0.12, 0.18, 0.14, 0.22, 0.16, 0.20, 0.15, 0.19], []);

  useEffect(() => {
    if (!isRecording || !mediaStream) {
      setLevels(idleLevels);
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);

      const bucket = Math.floor(data.length / bars);
      const next: number[] = [];
      for (let i = 0; i < bars; i++) {
        const start = i * bucket;
        const end = i === bars - 1 ? data.length : start + bucket;
        let sum = 0;
        for (let j = start; j < end; j++) sum += data[j] ?? 0;
        const avg = sum / Math.max(1, end - start);
        const norm = Math.min(1, Math.max(0.06, avg / 255));
        next.push(norm);
      }

      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;

      try {
        source.disconnect();
      } catch {
        // ignore
      }

      try {
        analyser.disconnect();
      } catch {
        // ignore
      }

      analyserRef.current = null;

      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
    };
  }, [idleLevels, isRecording, mediaStream]);

  return (
    <div className="flex items-end justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-5">
      {levels.map((lvl, idx) => {
        const h = Math.round(10 + lvl * 56);
        return (
          <motion.div
            key={idx}
            className="w-2 rounded-full bg-slate-900/80"
            animate={{ height: h }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            style={{ height: 14 }}
          />
        );
      })}
    </div>
  );
}



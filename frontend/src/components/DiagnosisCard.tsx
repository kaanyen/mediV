import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

export type Diagnosis = {
  condition: string;
  probability: number; // 0..1
  reasoning: string;
};

type Props = {
  diagnoses: Diagnosis[];
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export default function DiagnosisCard({ diagnoses }: Props) {
  const sorted = useMemo(() => {
    return [...diagnoses].sort((a, b) => clamp01(b.probability) - clamp01(a.probability));
  }, [diagnoses]);

  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (!sorted.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        No diagnoses yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-800">Differential Diagnosis</div>
      <div className="space-y-3">
        {sorted.map((d, idx) => {
          const p = clamp01(d.probability);
          const pct = Math.round(p * 100);
          const isOpen = openIdx === idx;
          return (
            <div key={`${d.condition}-${idx}`} className="rounded-xl border border-slate-200 p-3">
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{d.condition}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 w-full max-w-[260px] overflow-hidden rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="shrink-0 text-xs font-semibold text-slate-700">{pct}%</div>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronUp className="mt-0.5 h-4 w-4 text-slate-600" />
                ) : (
                  <ChevronDown className="mt-0.5 h-4 w-4 text-slate-600" />
                )}
              </button>
              {isOpen && (
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {d.reasoning}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



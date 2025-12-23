import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

export type Diagnosis = {
  condition: string;
  probability: number; // 0..1
  reasoning: string; // Brief "why" explanation
  detailed_reasoning?: string | null; // Full detailed analysis
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
          // Ensure probability is between 0 and 1
          const p = clamp01(d.probability);
          // Convert to percentage (0-100)
          const pct = Math.round(p * 100);
          const isOpen = openIdx === idx;
          
          // Debug: Log if probability seems wrong
          if (pct === 100 && p < 0.99) {
            console.warn(`[DiagnosisCard] Probability mismatch for ${d.condition}: p=${p}, pct=${pct}`);
          }
          
          return (
            <div key={`${d.condition}-${idx}`} className="rounded-xl border border-slate-200 p-3">
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900">{d.condition}</div>
                  
                  {/* Probability Bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 min-w-[120px] max-w-[260px] overflow-hidden rounded-full bg-slate-100 relative">
                      <div 
                        className="h-2 rounded-full bg-emerald-600 transition-all duration-300" 
                        style={{ 
                          width: `${pct}%`,
                          minWidth: pct > 0 ? '2px' : '0px',
                          maxWidth: '100%'
                        }} 
                      />
                    </div>
                    <div className="shrink-0 text-xs font-semibold text-slate-700 whitespace-nowrap">{pct}%</div>
                  </div>
                  
                  {/* Show brief reasoning by default - why AI thinks it's this disease */}
                  {d.reasoning && (
                    <div className="mt-2 text-xs leading-relaxed text-slate-600">
                      <span className="font-medium text-slate-700">Why: </span>
                      {d.reasoning}
                    </div>
                  )}
                </div>
                
                {/* Expandable button for more details */}
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="shrink-0 mt-0.5"
                  aria-label={isOpen ? "Collapse details" : "Expand details"}
                >
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-slate-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  )}
                </button>
              </div>
              
              {/* Expanded detailed reasoning */}
              {isOpen && (d.detailed_reasoning || d.reasoning) && (
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 border border-slate-200">
                  <div className="font-medium text-slate-800 mb-1">Detailed Analysis:</div>
                  <div className="text-xs leading-relaxed">{d.detailed_reasoning || d.reasoning}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



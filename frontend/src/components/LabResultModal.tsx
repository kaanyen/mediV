import { X } from "lucide-react";
import { useMemo, useState } from "react";

type Props = {
  isOpen: boolean;
  encounterId: string | null;
  requestedTests: string[];
  onClose: () => void;
  onSubmit: (results: Record<string, string>) => void;
};

function isBinaryTest(name: string): boolean {
  return /rdt/i.test(name);
}

export default function LabResultModal({ isOpen, encounterId, requestedTests, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  const tests = useMemo(() => requestedTests.filter(Boolean), [requestedTests]);

  if (!isOpen || !encounterId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-500">Result Entry</div>
            <div className="text-xl font-semibold text-slate-900">Enter lab results</div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-600 hover:bg-slate-50" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {tests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
              No requested tests found for this encounter.
            </div>
          ) : (
            tests.map((t) => {
              const val = values[t] ?? "";
              const binary = isBinaryTest(t);
              return (
                <div key={t} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">{t}</div>
                  <div className="mt-3">
                    {binary ? (
                      <div className="flex gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">
                          <input
                            type="radio"
                            name={`bin-${t}`}
                            checked={val === "Positive"}
                            onChange={() => setValues((v) => ({ ...v, [t]: "Positive" }))}
                          />
                          Positive
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">
                          <input
                            type="radio"
                            name={`bin-${t}`}
                            checked={val === "Negative"}
                            onChange={() => setValues((v) => ({ ...v, [t]: "Negative" }))}
                          />
                          Negative
                        </label>
                      </div>
                    ) : (
                      <input
                        value={val}
                        onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))}
                        type="text"
                        placeholder='e.g. "12.5" or "WBC 12.5"'
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none"
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(values)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Submit Results
          </button>
        </div>
      </div>
    </div>
  );
}



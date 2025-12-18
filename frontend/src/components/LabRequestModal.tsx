import { X } from "lucide-react";
import { useMemo, useState } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (labs: string[]) => void;
};

const commonLabs = ["Malaria RDT", "Widal", "FBC", "Urinalysis"] as const;

export default function LabRequestModal({ isOpen, onClose, onSubmit }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => ({}));
  const [other, setOther] = useState("");

  const labs = useMemo(() => {
    const out: string[] = [];
    for (const lab of commonLabs) {
      if (selected[lab]) out.push(lab);
    }
    const extra = other
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const x of extra) out.push(x);
    return out;
  }, [other, selected]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-500">Lab Request</div>
            <div className="text-xl font-semibold text-slate-900">Order labs & proceed</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {commonLabs.map((lab) => (
              <label
                key={lab}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-900 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={Boolean(selected[lab])}
                  onChange={(e) => setSelected((s) => ({ ...s, [lab]: e.target.checked }))}
                />
                <div className="font-semibold">{lab}</div>
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-slate-700">Other (comma-separated)</div>
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="e.g. U&E, LFT"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(labs)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Submit Order
          </button>
        </div>
      </div>
    </div>
  );
}



import { CheckCircle } from "lucide-react";

type Props = {
  label: string;
  value: string;
  isAiFilled: boolean;
};

export default function AutoFillInput({ label, value, isAiFilled }: Props) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="relative">
        <input
          value={value}
          readOnly
          className={[
            "w-full rounded-lg border px-3 py-2 text-slate-900 outline-none transition",
            "placeholder:text-slate-400",
            isAiFilled ? "border-green-500 bg-green-50" : "border-slate-200 bg-white"
          ].join(" ")}
        />
        <CheckCircle
          className={[
            "pointer-events-none absolute right-2 top-1/2 h-5 w-5 -translate-y-1/2 text-green-600 transition-opacity",
            isAiFilled ? "opacity-100" : "opacity-0"
          ].join(" ")}
        />
      </div>
    </div>
  );
}



import { Loader2, Pill } from "lucide-react";
import { useState } from "react";
import { getPrescription, type PrescriptionItem } from "../services/api";

type Props = {
  condition: string;
  diagnosis: string;
  patientWeight?: string;
  allergies?: string;
  age?: string;
  onClose: () => void;
  onPrescribe: (prescriptions: PrescriptionItem[]) => void;
};

export default function PrescriptionModal({
  condition,
  diagnosis,
  patientWeight,
  allergies,
  age,
  onClose,
  onPrescribe
}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetPrescription = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getPrescription({
        condition,
        diagnosis,
        patient_weight: patientWeight,
        allergies,
        age
      });
      if (res && res.prescriptions.length > 0) {
        setPrescriptions(res.prescriptions);
      } else {
        setError("No prescriptions generated. Please try again or prescribe manually.");
      }
    } catch {
      setError("Failed to get prescription. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrescribe = () => {
    if (prescriptions && prescriptions.length > 0) {
      onPrescribe(prescriptions);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="text-sm font-semibold text-slate-500">Prescription</div>
          <div className="text-xl font-semibold text-slate-900">Generate Prescription for {condition}</div>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
          {!prescriptions ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-700">
                  <div className="font-semibold">Condition:</div>
                  <div className="mt-1">{condition}</div>
                </div>
                <div className="mt-3 text-sm text-slate-700">
                  <div className="font-semibold">Diagnosis:</div>
                  <div className="mt-1">{diagnosis}</div>
                </div>
                {patientWeight && (
                  <div className="mt-3 text-sm text-slate-700">
                    <div className="font-semibold">Weight:</div>
                    <div className="mt-1">{patientWeight} kg</div>
                  </div>
                )}
                {allergies && (
                  <div className="mt-3 text-sm text-slate-700">
                    <div className="font-semibold">Allergies:</div>
                    <div className="mt-1">{allergies}</div>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                onClick={() => void handleGetPrescription()}
                disabled={isLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating Prescription...
                  </>
                ) : (
                  <>
                    <Pill className="h-4 w-4" />
                    Generate Prescription with AI
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Recommended Prescriptions:</div>
              {prescriptions.map((pres, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <Pill className="h-5 w-5 text-slate-400" />
                    <div className="flex-1">
                      <div className="font-semibold text-slate-900">{pres.medication}</div>
                      <div className="mt-1 space-y-1 text-sm text-slate-600">
                        <div>Dosage: {pres.dosage}</div>
                        <div>Frequency: {pres.frequency}</div>
                        <div>Duration: {pres.duration}</div>
                        {pres.instructions && (
                          <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs">
                            {pres.instructions}
                          </div>
                        )}
                        {pres.warnings && (
                          <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                            ⚠️ {pres.warnings}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          {prescriptions && prescriptions.length > 0 && (
            <button
              onClick={handlePrescribe}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Send to Pharmacy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


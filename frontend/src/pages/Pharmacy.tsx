import { Plus, Search, Trash2, Edit2, Package, Printer, CheckCircle2, XCircle, AlertTriangle, Minus, ShoppingCart, TrendingDown, TrendingUp, Filter, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { createDrug, deleteDrug, listDrugs, searchDrugs, updateDrug, type Drug, type DrugCreateRequest } from "../services/api";
import { getEncountersByStatus, dischargeEncounter } from "../services/db";
import type { Encounter, Patient } from "../types/schema";
import { getAllPatients } from "../services/db";
import { printPrescriptionPdf } from "../utils/printPrescription";
import { toast } from "../components/ui/toaster";

type DispensedItem = {
  medication: string;
  quantity: number;
  available: boolean;
  stock: number;
};

export default function Pharmacy() {
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<Drug | null>(null);
  const [selectedEncounter, setSelectedEncounter] = useState<Encounter | null>(null);
  const [dispensedItems, setDispensedItems] = useState<Record<string, DispensedItem>>({});
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [isLoadingDrugs, setIsLoadingDrugs] = useState(true);
  const [formData, setFormData] = useState<DrugCreateRequest>({
    name: "",
    genericName: "",
    category: "",
    dosageForm: "",
    strength: "",
    stock: 0,
    unit: "",
    expiryDate: "",
    supplier: "",
    price: 0
  });

  const loadDrugs = async () => {
    setIsLoadingDrugs(true);
    try {
      const res = await listDrugs();
      if (res && res.drugs) {
        console.log(`[Pharmacy] Loaded ${res.drugs.length} drugs`);
        setDrugs(res.drugs);
        if (res.drugs.length === 0) {
          toast({
            type: "info",
            title: "No Drugs Found",
            message: "The drug inventory is empty. Add drugs to get started."
          });
        }
      } else {
        console.warn("[Pharmacy] No drugs received from API");
        toast({
          type: "error",
          title: "Failed to Load Drugs",
          message: "Could not load drug inventory. Please refresh the page."
        });
      }
    } catch (error) {
      console.error("[Pharmacy] Error loading drugs:", error);
      toast({
        type: "error",
        title: "Connection Error",
        message: "Could not connect to the server. Make sure the backend is running on http://localhost:8000"
      });
    } finally {
      setIsLoadingDrugs(false);
    }
  };

  const loadPharmacyQueue = async () => {
    const [pharmacyEncounters, allPatients] = await Promise.all([
      getEncountersByStatus("pharmacy"),
      getAllPatients()
    ]);
    setEncounters(pharmacyEncounters);
    const map: Record<string, Patient> = {};
    for (const p of allPatients) map[p._id] = p;
    setPatientsById(map);
  };

  useEffect(() => {
    void loadDrugs();
    void loadPharmacyQueue();
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timeout = setTimeout(async () => {
        const res = await searchDrugs(searchQuery);
        if (res) {
          setDrugs(res.drugs);
        }
      }, 300);
      return () => clearTimeout(timeout);
    } else {
      void loadDrugs();
    }
  }, [searchQuery]);

  // Initialize dispensed items when encounter is selected
  useEffect(() => {
    if (selectedEncounter && selectedEncounter.prescriptions) {
      const items: Record<string, DispensedItem> = {};
      selectedEncounter.prescriptions.forEach((pres) => {
        const drug = findDrugByName(pres.medication);
        const available = !!(drug && drug.stock > 0);
        items[pres.medication] = {
          medication: pres.medication,
          quantity: 1, // Default quantity
          available,
          stock: drug?.stock || 0
        };
      });
      setDispensedItems(items);
    }
  }, [selectedEncounter, drugs]);

  const findDrugByName = (medicationName: string): Drug | undefined => {
    const lowerName = medicationName.toLowerCase();
    return drugs.find(
      (d) =>
        d.name.toLowerCase().includes(lowerName) ||
        d.genericName?.toLowerCase().includes(lowerName)
    );
  };

  const checkDrugAvailability = (medicationName: string): { available: boolean; stock: number; drug?: Drug } => {
    const drug = findDrugByName(medicationName);
    if (!drug) {
      return { available: false, stock: 0 };
    }
    const item = dispensedItems[medicationName];
    const requestedQty = item?.quantity || 1;
    return {
      available: drug.stock >= requestedQty,
      stock: drug.stock,
      drug
    };
  };

  const updateDispensedQuantity = (medication: string, delta: number) => {
    setDispensedItems((prev) => {
      const current = prev[medication] || { medication, quantity: 1, available: false, stock: 0 };
      const newQty = Math.max(1, current.quantity + delta);
      const availability = checkDrugAvailability(medication);
      return {
        ...prev,
        [medication]: {
          ...current,
          quantity: newQty,
          available: availability.available && availability.stock >= newQty,
          stock: availability.stock
        }
      };
    });
  };

  const handleDispense = async (encounterId: string) => {
    if (!selectedEncounter) return;

    // Update drug stocks
    const updates: Promise<Drug | null>[] = [];
    Object.values(dispensedItems).forEach((item) => {
      const drug = findDrugByName(item.medication);
      if (drug && item.available) {
        const newStock = drug.stock - item.quantity;
        if (newStock >= 0) {
          updates.push(updateDrug(drug._id, { ...drug, stock: newStock }));
        }
      }
    });

    await Promise.all(updates);
    await loadDrugs();

    // Discharge patient
    const patient = patientsById[selectedEncounter.patientId];
    const diagnosisText = selectedEncounter.finalAnalysis || 
      (selectedEncounter.finalDiagnosis && selectedEncounter.finalDiagnosis.length > 0
        ? selectedEncounter.finalDiagnosis.map((d) => d.condition).join(", ")
        : "Diagnosis not recorded");

    await dischargeEncounter(
      encounterId,
      selectedEncounter.finalDiagnosis || [],
      diagnosisText
    );

    await loadPharmacyQueue();
    setSelectedEncounter(null);
    setDispensedItems({});
    toast({
      type: "success",
      title: "✅ Patient Discharged",
      message: "Patient discharged successfully! Drugs dispensed and stock updated."
    });
  };

  const handleOpenModal = (drug?: Drug) => {
    if (drug) {
      setEditingDrug(drug);
      setFormData({
        name: drug.name,
        genericName: drug.genericName || "",
        category: drug.category,
        dosageForm: drug.dosageForm,
        strength: drug.strength,
        stock: drug.stock,
        unit: drug.unit,
        expiryDate: drug.expiryDate || "",
        supplier: drug.supplier || "",
        price: drug.price || 0
      });
    } else {
      setEditingDrug(null);
      setFormData({
        name: "",
        genericName: "",
        category: "",
        dosageForm: "",
        strength: "",
        stock: 0,
        unit: "",
        expiryDate: "",
        supplier: "",
        price: 0
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.category || !formData.dosageForm || !formData.strength) {
      toast({
        type: "error",
        title: "Validation Error",
        message: "Please fill in all required fields"
      });
      return;
    }

    if (editingDrug) {
      const updated = await updateDrug(editingDrug._id, formData);
      if (updated) {
        await loadDrugs();
        setIsModalOpen(false);
        toast({
          type: "success",
          title: "Drug Updated",
          message: `${formData.name} has been updated successfully.`
        });
      } else {
        toast({
          type: "error",
          title: "Update Failed",
          message: "Failed to update drug. Please try again."
        });
      }
    } else {
      const created = await createDrug(formData);
      if (created) {
        await loadDrugs();
        setIsModalOpen(false);
        toast({
          type: "success",
          title: "Drug Added",
          message: `${formData.name} has been added to inventory.`
        });
      } else {
        toast({
          type: "error",
          title: "Add Failed",
          message: "Failed to add drug. Please try again."
        });
      }
    }
  };

  const handleDelete = async (drugId: string) => {
    const drug = drugs.find((d) => d._id === drugId);
    const drugName = drug?.name || "this drug";
    
    if (window.confirm(`Are you sure you want to delete ${drugName}? This action cannot be undone.`)) {
      const success = await deleteDrug(drugId);
      if (success) {
        await loadDrugs();
        toast({
          type: "success",
          title: "Drug Deleted",
          message: `${drugName} has been removed from inventory.`
        });
      } else {
        toast({
          type: "error",
          title: "Delete Failed",
          message: "Failed to delete drug. Please try again."
        });
      }
    }
  };

  const filteredDrugs = drugs.filter((drug) => {
    if (stockFilter === "low") return drug.stock < 50 && drug.stock > 0;
    if (stockFilter === "out") return drug.stock === 0;
    return true;
  });
  
  // Debug: Log drug counts
  useEffect(() => {
    console.log(`[Pharmacy Debug] Total drugs: ${drugs.length}, Filtered: ${filteredDrugs.length}, Filter: ${stockFilter}, Search: "${searchQuery}"`);
  }, [drugs.length, filteredDrugs.length, stockFilter, searchQuery]);

  const lowStockCount = drugs.filter((d) => d.stock < 50 && d.stock > 0).length;
  const outOfStockCount = drugs.filter((d) => d.stock === 0).length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">Pharmacy</div>
          <h1 className="text-2xl font-semibold text-slate-900">Drug Inventory & Dispensing</h1>
          {drugs.length > 0 && (
            <div className="mt-1 text-sm text-slate-600">
              {drugs.length} {drugs.length === 1 ? "drug" : "drugs"} in inventory
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(lowStockCount > 0 || outOfStockCount > 0) && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 border border-amber-200">
              {lowStockCount > 0 && (
                <div className="flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-semibold">{lowStockCount} low stock</span>
                </div>
              )}
              {outOfStockCount > 0 && (
                <div className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm font-semibold">{outOfStockCount} out of stock</span>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => handleOpenModal()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Add Drug
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_450px]">
        {/* Drug Inventory */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search drugs by name, category..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-2 text-sm text-slate-900 outline-none"
                />
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setStockFilter("all")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    stockFilter === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStockFilter("low")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    stockFilter === "low"
                      ? "bg-amber-500 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Low ({lowStockCount})
                </button>
                <button
                  onClick={() => setStockFilter("out")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    stockFilter === "out"
                      ? "bg-red-500 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Out ({outOfStockCount})
                </button>
              </div>
            </div>

            <div className="relative">
              {/* Scroll gradient indicators */}
              <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-white to-transparent pointer-events-none z-10 rounded-t-xl" />
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-b from-transparent to-white pointer-events-none z-10 rounded-b-xl" />
              
              <div className="space-y-2 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100 pr-2">
                {filteredDrugs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No drugs found
                </div>
              ) : (
                filteredDrugs.map((drug) => {
                  const isLowStock = drug.stock < 50 && drug.stock > 0;
                  const isOutOfStock = drug.stock === 0;
                  return (
                    <div
                      key={drug._id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-4 shadow-sm min-w-0 ${
                        isOutOfStock
                          ? "border-red-200 bg-red-50"
                          : isLowStock
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className={`h-4 w-4 shrink-0 ${
                            isOutOfStock ? "text-red-500" : isLowStock ? "text-amber-500" : "text-slate-400"
                          }`} />
                          <div className="font-semibold text-slate-900 truncate">{drug.name}</div>
                          {drug.genericName && (
                            <div className="text-sm text-slate-500 truncate shrink-0">({drug.genericName})</div>
                          )}
                          {isOutOfStock && (
                            <span className="shrink-0 text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                              OUT
                            </span>
                          )}
                          {isLowStock && !isOutOfStock && (
                            <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
                              LOW
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                          <span className="truncate">{drug.category}</span>
                          <span className="shrink-0">•</span>
                          <span className="truncate">{drug.strength}</span>
                          <span className="shrink-0">•</span>
                          <span className="truncate">{drug.dosageForm}</span>
                          <span className="shrink-0">•</span>
                          <span className={`truncate font-semibold ${
                            isOutOfStock ? "text-red-600" : isLowStock ? "text-amber-600" : "text-slate-900"
                          }`}>
                            Stock: {drug.stock} {drug.unit}
                          </span>
                          {drug.price && <span className="shrink-0">•</span>}
                          {drug.price && <span className="truncate">₵{drug.price.toFixed(2)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenModal(drug)}
                          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(drug._id)}
                          className="rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          </div>
        </div>

        {/* Pharmacy Queue & Dispensing */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-blue-900">Pharmacy Queue</div>
              <div className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                {encounters.length}
              </div>
            </div>
            <div className="relative">
              {/* Scroll gradient indicators */}
              <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-blue-50 to-transparent pointer-events-none z-10 rounded-t-xl" />
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-blue-50 pointer-events-none z-10 rounded-b-xl" />
              
              <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-300 scrollbar-track-blue-100 pr-2">
                {encounters.length === 0 ? (
                <div className="rounded-xl border border-dashed border-blue-200 bg-white px-3 py-6 text-center text-sm text-blue-600">
                  No patients in queue
                </div>
              ) : (
                encounters.map((enc) => {
                  const patient = patientsById[enc.patientId];
                  const hasPrescriptions = enc.prescriptions && enc.prescriptions.length > 0;
                  const isSelected = selectedEncounter?._id === enc._id;

                  return (
                    <div
                      key={enc._id}
                      className={`rounded-xl border p-3 shadow-sm space-y-2 cursor-pointer transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-100 border-2"
                          : "border-blue-200 bg-white hover:border-blue-300"
                      }`}
                      onClick={() => setSelectedEncounter(enc)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 truncate">{patient?.name ?? "Unknown"}</div>
                          <div className="mt-0.5 text-[11px] text-slate-600">
                            {enc.finalDiagnosis && enc.finalDiagnosis.length
                              ? enc.finalDiagnosis.map((d) => d.condition).join(", ")
                              : "Diagnosis not recorded"}
                          </div>
                        </div>
                        {hasPrescriptions && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              printPrescriptionPdf({
                                patient: {
                                  name: patient?.name ?? "Unknown",
                                  age: patient?.age,
                                  sex: patient?.sex
                                },
                                diagnosisSummary: (() => {
                                  if (enc.finalAnalysis && enc.finalAnalysis.trim().length) {
                                    return enc.finalAnalysis.trim();
                                  }
                                  if (enc.finalDiagnosis && enc.finalDiagnosis.length > 0) {
                                    const conditions = enc.finalDiagnosis
                                      .map((d) => d.condition || (d as any).diagnosis || "")
                                      .filter(Boolean);
                                    if (conditions.length > 0) {
                                      return conditions.join(", ");
                                    }
                                  }
                                  if (enc.initialDiagnosis && enc.initialDiagnosis.length > 0) {
                                    const conditions = enc.initialDiagnosis
                                      .map((d) => d.condition || (d as any).diagnosis || "")
                                      .filter(Boolean);
                                    if (conditions.length > 0) {
                                      return conditions.join(", ");
                                    }
                                  }
                                  return "Diagnosis not recorded";
                                })(),
                                vitals: enc.vitals
                                  ? {
                                      bp: enc.vitals.bp,
                                      temp: enc.vitals.temp,
                                      pulse: enc.vitals.pulse,
                                      spo2: enc.vitals.spo2,
                                      weight: enc.vitals.weight
                                    }
                                  : undefined,
                                prescriptions: (enc.prescriptions ?? []).map((p) => ({
                                  medication: p.medication,
                                  dosage: p.dosage,
                                  frequency: p.frequency,
                                  duration: p.duration,
                                  instructions: p.instructions,
                                  warnings: p.warnings
                                }))
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100"
                          >
                            <Printer className="h-3 w-3" />
                            Print
                          </button>
                        )}
                      </div>

                      {hasPrescriptions && (
                        <div className="mt-1 space-y-1 text-xs text-slate-600">
                          {enc.prescriptions!.slice(0, 2).map((pres, idx) => {
                            const availability = checkDrugAvailability(pres.medication);
                            return (
                              <div key={idx} className="flex items-center gap-2 min-w-0">
                                {availability.available ? (
                                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                                )}
                                <span className="break-words min-w-0 truncate">
                                  {pres.medication}
                                </span>
                              </div>
                            );
                          })}
                          {enc.prescriptions!.length > 2 && (
                            <div className="text-[10px] text-slate-500">
                              +{enc.prescriptions!.length - 2} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              </div>
            </div>
          </div>

          {/* Dispensing Panel */}
          {selectedEncounter && selectedEncounter.prescriptions && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-green-900">Dispensing</div>
                <div className="text-xs text-green-700">
                  {patientsById[selectedEncounter.patientId]?.name}
                </div>
              </div>
              <div className="relative">
                {/* Scroll gradient indicators */}
                <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-green-50 to-transparent pointer-events-none z-10 rounded-t-xl" />
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-green-50 pointer-events-none z-10 rounded-b-xl" />
                
                <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-green-300 scrollbar-track-green-100 pr-2">
                  {selectedEncounter.prescriptions.map((pres, idx) => {
                  const item = dispensedItems[pres.medication];
                  const availability = checkDrugAvailability(pres.medication);
                  const isAvailable = item?.available || false;

                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border p-3 ${
                        isAvailable
                          ? "border-green-300 bg-white"
                          : "border-red-300 bg-red-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isAvailable ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                            )}
                            <div className="font-semibold text-slate-900 truncate">
                              {pres.medication}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {pres.dosage} • {pres.frequency} • {pres.duration}
                          </div>
                          <div className={`mt-1 text-xs font-semibold ${
                            isAvailable ? "text-green-700" : "text-red-700"
                          }`}>
                            Stock: {availability.stock} {availability.drug?.unit || ""}
                            {!isAvailable && availability.stock > 0 && (
                              <span className="ml-2">(Need {item?.quantity || 1})</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isAvailable && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-slate-600">Quantity:</span>
                          <button
                            onClick={() => updateDispensedQuantity(pres.medication, -1)}
                            className="rounded-lg border border-slate-200 bg-white p-1 hover:bg-slate-50"
                            disabled={item?.quantity <= 1}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-12 text-center text-sm font-semibold">
                            {item?.quantity || 1}
                          </span>
                          <button
                            onClick={() => updateDispensedQuantity(pres.medication, 1)}
                            className="rounded-lg border border-slate-200 bg-white p-1 hover:bg-slate-50"
                            disabled={item && item.quantity >= availability.stock}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
              <button
                onClick={() => handleDispense(selectedEncounter._id)}
                disabled={Object.values(dispensedItems).some((item) => !item.available)}
                className="mt-4 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <ShoppingCart className="h-4 w-4" />
                Dispense & Discharge Patient
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Drug Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="text-sm font-semibold text-slate-500">Drug Management</div>
              <div className="text-xl font-semibold text-slate-900">
                {editingDrug ? "Edit Drug" : "Add New Drug"}
              </div>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700">Drug Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. Paracetamol"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Generic Name</label>
                  <input
                    type="text"
                    value={formData.genericName || ""}
                    onChange={(e) => setFormData({ ...formData, genericName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. Acetaminophen"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Category *</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. Analgesic"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Dosage Form *</label>
                  <input
                    type="text"
                    value={formData.dosageForm}
                    onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. tablet, capsule, syrup"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Strength *</label>
                  <input
                    type="text"
                    value={formData.strength}
                    onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. 500mg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Unit *</label>
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. tablets, bottles"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Stock *</label>
                  <input
                    type="number"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })}
                    min={0}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Price (₵)</label>
                  <input
                    type="number"
                    value={formData.price || ""}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) || 0 })}
                    min={0}
                    step={0.01}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate || ""}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Supplier</label>
                  <input
                    type="text"
                    value={formData.supplier || ""}
                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none"
                    placeholder="e.g. Pharma Ltd"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {editingDrug ? "Update" : "Add"} Drug
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

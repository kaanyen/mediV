import { Brain, Database, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AccessibilityWidget from "../shared/AccessibilityWidget";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  return online;
}

type AiStatus = "checking" | "ready" | "offline" | "disabled";

function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>("checking");

  useEffect(() => {
    // Disable AI health checks if API is localhost on HTTPS (common in production)
    const isLocalhostOnHttps = 
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      (API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1"));

    if (isLocalhostOnHttps) {
      setStatus("disabled");
      return;
    }

    let cancelled = false;
    const check = async () => {
      try {
        const url = `${API_BASE_URL}/health`;
        const res = await fetch(url, {
          method: "GET",
          mode: "cors",
          headers: {
            "Accept": "application/json",
          },
        });
        if (cancelled) return;
        setStatus(res.ok ? "ready" : "offline");
      } catch {
        if (cancelled) return;
        setStatus("offline");
      }
    };

    check();
    const interval = setInterval(check, 10000); // Check every 10 seconds

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const online = useOnlineStatus();
  const ai = useAiStatus();

  const active = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/lab")) return "Lab";
    if (p.startsWith("/pharmacy")) return "Pharmacy";
    if (p.startsWith("/doctor") || p.startsWith("/consultation") || p.startsWith("/post-lab")) return "Doctor";
    return "Nurse";
  }, [location.pathname]);

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-slate-900">MediVoice</div>
            <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{active} Module</div>

            <div className="hidden items-center gap-2 sm:flex">
              <Link
                to="/"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Nurse" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Nurse
              </Link>
              <Link
                to="/doctor"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Doctor" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Doctor
              </Link>
              <Link
                to="/lab"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Lab" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Lab
              </Link>
              <Link
                to="/pharmacy"
                className={[
                  "rounded-xl px-3 py-1.5 text-xs font-semibold",
                  active === "Pharmacy" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                ].join(" ")}
              >
                Pharmacy
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm font-semibold text-slate-700">
            <div className="inline-flex items-center gap-2" title="DB Status">
              <Database className="h-4 w-4 text-slate-600" />
              {online ? <Wifi className="h-4 w-4 text-emerald-600" /> : <WifiOff className="h-4 w-4 text-slate-400" />}
              <span className={online ? "text-emerald-700" : "text-slate-500"}>{online ? "DB Online" : "DB Offline"}</span>
            </div>

            {ai !== "disabled" && (
              <div className="inline-flex items-center gap-2" title="AI Status (GET /health)">
                <Brain
                  className={[
                    "h-4 w-4",
                    ai === "ready" ? "text-emerald-600" : ai === "offline" ? "text-red-600" : "text-slate-400"
                  ].join(" ")}
                />
                <span className={ai === "ready" ? "text-emerald-700" : ai === "offline" ? "text-red-700" : "text-slate-500"}>
                  {ai === "ready" ? "AI Ready" : ai === "offline" ? "AI Offline" : "AI Checking"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {children}
      <AccessibilityWidget />
    </div>
  );
}


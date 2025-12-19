import { Brain, Database, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "../ui/toaster";

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

type AiStatus = "checking" | "ready" | "offline" | "disabled";

// Get API base URL from environment, same as api.ts
const API_BASE_URL = "https://subcollegiate-mamie-superbrave.ngrok-free.dev";

function useAiStatus(pollMs = 6000): AiStatus {
  const [status, setStatus] = useState<AiStatus>("checking");
  const online = useOnlineStatus();

  useEffect(() => {
    // Skip health checks if we're on HTTPS (production) and API is localhost
    // This prevents CORS errors on Vercel deployments
    const isProduction = window.location.protocol === "https:";
    const isLocalhostApi = API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1");

    if (isProduction && isLocalhostApi) {
      if (status !== "disabled") setStatus("disabled");
      return;
    }

    let cancelled = false;
    let lastToastAt = 0;

    async function ping() {
      if (!online) {
        if (!cancelled) setStatus("offline");
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
        if (!cancelled) setStatus(res.ok ? "ready" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
        const now = Date.now();
        if (now - lastToastAt > 7000) {
          lastToastAt = now;
          toast({
            type: "error",
            title: "AI Server Offline",
            message: "Python backend is unreachable. You can continue with manual entry."
          });
        }
      }
    }

    void ping();
    const id = window.setInterval(() => void ping(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [online, pollMs, status]);

  return status;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const online = useOnlineStatus();
  const ai = useAiStatus();

  const active = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/lab")) return "Lab";
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
    </div>
  );
}



import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export type Toast = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  createdAt: number;
};

type ToastContextValue = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "createdAt">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Imperative bridge so non-React code (e.g. axios interceptors) can trigger toasts.
let externalPush: ToastContextValue["push"] | null = null;

export function toast(t: Omit<Toast, "id" | "createdAt">) {
  externalPush?.(t);
}

function colorFor(type: ToastType): { 
  border: string; 
  bg: string; 
  title: string; 
  text: string;
  iconBg: string;
  iconColor: string;
} {
  switch (type) {
    case "success":
      return { 
        border: "border-emerald-300", 
        bg: "bg-white", 
        title: "text-emerald-900", 
        text: "text-emerald-800",
        iconBg: "bg-emerald-100",
        iconColor: "text-emerald-600"
      };
    case "error":
      return { 
        border: "border-red-300", 
        bg: "bg-white", 
        title: "text-red-900", 
        text: "text-red-800",
        iconBg: "bg-red-100",
        iconColor: "text-red-600"
      };
    case "info":
    default:
      return { 
        border: "border-blue-300", 
        bg: "bg-white", 
        title: "text-blue-900", 
        text: "text-blue-800",
        iconBg: "bg-blue-100",
        iconColor: "text-blue-600"
      };
  }
}

function getIcon(type: ToastType) {
  switch (type) {
    case "success":
      return CheckCircle2;
    case "error":
      return XCircle;
    case "info":
    default:
      return Info;
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  const push = useCallback(
    (t: Omit<Toast, "id" | "createdAt">) => {
      const id = crypto.randomUUID();
      const next: Toast = { ...t, id, createdAt: Date.now() };
      setToasts((prev) => [next, ...prev].slice(0, 5));
      // Auto-dismiss after 4 seconds.
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  // Expose push to non-React callers.
  externalPush = push;

  const value = useMemo<ToastContextValue>(() => ({ toasts, push, dismiss, clear }), [toasts, push, dismiss, clear]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast viewport */}
      <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
        {toasts.map((t, index) => {
          const c = colorFor(t.type);
          const Icon = getIcon(t.type);
          return (
            <div
              key={t.id}
              className={[
                "pointer-events-auto",
                "rounded-xl border-2 shadow-2xl backdrop-blur-sm",
                "transform transition-all duration-300 ease-out",
                "animate-[slideIn_0.3s_ease-out]",
                "hover:scale-[1.02] hover:shadow-3xl",
                c.border,
                c.bg
              ].join(" ")}
              role="status"
              aria-live="polite"
              style={{
                animationDelay: `${index * 50}ms`
              }}
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                {/* Icon */}
                <div className={[
                  "flex-shrink-0 rounded-full p-1.5",
                  c.iconBg
                ].join(" ")}>
                  <Icon className={["h-5 w-5", c.iconColor].join(" ")} />
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  {t.title && (
                    <div className={["text-sm font-bold mb-0.5", c.title].join(" ")}>
                      {t.title}
                    </div>
                  )}
                  <div className={["text-sm leading-relaxed", c.text].join(" ")}>
                    {t.message}
                  </div>
                </div>
                
                {/* Close button */}
                <button
                  onClick={() => dismiss(t.id)}
                  className={[
                    "flex-shrink-0 rounded-lg p-1 transition-colors",
                    "hover:bg-slate-100 active:bg-slate-200",
                    "text-slate-400 hover:text-slate-600"
                  ].join(" ")}
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
}



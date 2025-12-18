import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

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

function colorFor(type: ToastType): { border: string; bg: string; title: string; text: string } {
  switch (type) {
    case "success":
      return { border: "border-emerald-200", bg: "bg-emerald-50", title: "text-emerald-900", text: "text-emerald-800" };
    case "error":
      return { border: "border-red-200", bg: "bg-red-50", title: "text-red-900", text: "text-red-800" };
    case "info":
    default:
      return { border: "border-blue-200", bg: "bg-blue-50", title: "text-blue-900", text: "text-blue-800" };
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
        {toasts.map((t) => {
          const c = colorFor(t.type);
          return (
            <div
              key={t.id}
              className={[
                "pointer-events-auto rounded-2xl border px-4 py-3 shadow-xl",
                c.border,
                c.bg
              ].join(" ")}
              role="status"
            >
              {t.title && <div className={["text-sm font-semibold", c.title].join(" ")}>{t.title}</div>}
              <div className={["text-sm", c.text].join(" ")}>{t.message}</div>
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



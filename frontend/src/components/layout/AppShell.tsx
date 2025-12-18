import type { ReactNode } from "react";
import AccessibilityWidget from "../shared/AccessibilityWidget";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AccessibilityWidget />
    </>
  );
}



"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

interface DemoModeContextType {
  demoMode: boolean;
  setDemoMode: (val: boolean) => void;
}

const DemoModeContext = createContext<DemoModeContextType | undefined>(undefined);

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [demoMode, setDemoModeState] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("deosai_demo_mode");
    if (stored !== null) {
      setDemoModeState(stored === "true");
    } else {
      // Default to false (Live Mode) for production
      window.localStorage.setItem("deosai_demo_mode", "false");
      setDemoModeState(false);
    }
    setMounted(true);
  }, []);

  const setDemoMode = (val: boolean) => {
    setDemoModeState(val);
    window.localStorage.setItem("deosai_demo_mode", String(val));
    // Trigger custom storage event so other open tabs update
    window.dispatchEvent(new Event("storage"));
  };

  // Sync state between tabs
  useEffect(() => {
    const handleStorageChange = () => {
      const stored = window.localStorage.getItem("deosai_demo_mode");
      if (stored !== null) {
        setDemoModeState(stored === "true");
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // For regular sellers in production, force live mode (demoMode = false). Only admins can toggle demoMode.
  const isEffectiveDemoMode = mounted && user?.role === "admin" ? demoMode : false;

  return (
    <DemoModeContext.Provider value={{ demoMode: isEffectiveDemoMode, setDemoMode }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  const context = useContext(DemoModeContext);
  if (context === undefined) {
    throw new Error("useDemoMode must be used within a DemoModeProvider");
  }
  return context;
}

export function DemoModeSwitch() {
  const { demoMode, setDemoMode } = useDemoMode();
  const { user } = useAuth();

  // Only render the Live Mode / Demo Mode toggle for sellers with role 'admin'
  if (user?.role !== "admin") {
    return null;
  }

  return (
    <button
      onClick={() => setDemoMode(!demoMode)}
      title={demoMode ? "Switch to Live Database records" : "Switch to Mock Demo data"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-all duration-300 shadow-xs hover:scale-102 active:scale-98 select-none font-landing",
        demoMode
          ? "bg-marigold-soft/40 border-marigold/40 text-[#8a5a12] hover:bg-marigold-soft/60"
          : "bg-teal-soft/30 border-teal/30 text-teal hover:bg-teal-soft/50"
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className={cn(
          "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
          demoMode ? "bg-marigold" : "bg-live"
        )} />
        <span className={cn(
          "relative inline-flex rounded-full h-2 w-2",
          demoMode ? "bg-[#b28014]" : "bg-live"
        )} />
      </span>
      <span>{demoMode ? "✦ Demo Mode" : "🌐 Live Mode"}</span>
    </button>
  );
}

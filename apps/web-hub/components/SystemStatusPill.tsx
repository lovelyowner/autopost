"use client";

import React, { useEffect, useState } from "react";

interface HealthResponse {
  ok: boolean;
  redis: boolean;
  stealthWorker: boolean;
  ffmpeg: boolean;
  vaultProfilesCount: number;
  apiProvidersConfigured: number;
}

export function SystemStatusPill() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const fetchHealth = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as HealthResponse;
        setHealth(data);
      }
    } catch {
      // Non-fatal
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void fetchHealth();
    const timer = setInterval(() => {
      void fetchHealth();
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!health) {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono">
        Checking stack...
      </span>
    );
  }

  const allOk = health.ok;
  return (
    <button
      type="button"
      onClick={() => void fetchHealth()}
      title="Click to re-check Redis, Stealth Browser Worker, and FFmpeg health"
      className={`text-[11px] px-2.5 py-0.5 rounded border font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
        allOk
          ? "bg-emerald-950/70 text-emerald-300 border-emerald-800/80 hover:bg-emerald-900/70"
          : "bg-amber-950/70 text-amber-300 border-amber-800/80 hover:bg-amber-900/70"
      }`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          allOk ? "bg-emerald-400" : "bg-amber-400"
        }`}
      />
      <span>
        {checking
          ? "Refreshing..."
          : allOk
          ? `Stack Online · ${health.vaultProfilesCount} Vault / ${health.apiProvidersConfigured} API`
          : `Degraded (${[
              !health.redis && "Redis",
              !health.stealthWorker && "Stealth",
              !health.ffmpeg && "FFmpeg",
            ]
              .filter(Boolean)
              .join(", ")} offline)`}
      </span>
    </button>
  );
}

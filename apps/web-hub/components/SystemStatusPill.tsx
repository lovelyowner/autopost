"use client";

import React, { useEffect, useState } from "react";
import { getClientCredentials } from "@/lib/client-vault";
import {
  COMPANION_CHANGED_EVENT,
  CREDENTIALS_CHANGED_EVENT,
  detectActiveCompanion,
} from "@/lib/companion-bridge";
import { buildClientApiFlags } from "@/lib/credential-mapping";

interface HealthResponse {
  ok: boolean;
  cloudMode?: boolean;
  redis: boolean;
  stealthWorker: boolean;
  ffmpeg: boolean;
  vaultProfilesCount: number;
  apiProvidersConfigured: number;
}

export function SystemStatusPill() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [companionProfilesCount, setCompanionProfilesCount] = useState<number | null>(null);
  const [clientApiCount, setClientApiCount] = useState(0);
  const [checking, setChecking] = useState(false);

  const refreshClientApiCount = () => {
    const flags = buildClientApiFlags(getClientCredentials(), {});
    setClientApiCount(Object.values(flags).filter(Boolean).length);
  };

  const fetchHealth = async () => {
    setChecking(true);
    refreshClientApiCount();
    try {
      const [res, companion] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }),
        detectActiveCompanion(),
      ]);
      setCompanionProfilesCount(companion ? companion.profiles.length : null);
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
    const onCredChange = () => refreshClientApiCount();
    const onCompanionChange = () => void fetchHealth();
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, onCredChange);
    window.addEventListener(COMPANION_CHANGED_EVENT, onCompanionChange);
    const timer = setInterval(() => {
      void fetchHealth();
    }, 30_000);
    return () => {
      window.removeEventListener(CREDENTIALS_CHANGED_EVENT, onCredChange);
      window.removeEventListener(COMPANION_CHANGED_EVENT, onCompanionChange);
      clearInterval(timer);
    };
  }, []);

  if (!health) {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono whitespace-nowrap shrink-0">
        Checking stack...
      </span>
    );
  }

  const companionOnline = companionProfilesCount !== null;
  const effectiveStealth = health.stealthWorker || companionOnline;
  const effectiveVaultCount = Math.max(health.vaultProfilesCount, companionProfilesCount ?? 0);
  const effectiveApiCount = Math.max(health.apiProvidersConfigured, clientApiCount);
  const allOk = health.ok;
  const allWorkersOffline = !health.redis && !effectiveStealth && !health.ffmpeg;

  let pillClass = "bg-amber-950/70 text-amber-300 border-amber-800/80 hover:bg-amber-900/70";
  let dotClass = "bg-amber-400";
  let label = "";

  if (allOk) {
    pillClass = "bg-emerald-950/70 text-emerald-300 border-emerald-800/80 hover:bg-emerald-900/70";
    dotClass = "bg-emerald-400";
    label = `Stack Online · ${effectiveVaultCount} Vault / ${effectiveApiCount} API`;
  } else if (companionOnline) {
    pillClass = "bg-emerald-950/70 text-emerald-300 border-emerald-800/80 hover:bg-emerald-900/70";
    dotClass = "bg-emerald-400";
    label = `Cloud UI + Companion · ${effectiveVaultCount} Vault / ${effectiveApiCount} API`;
  } else if (health.cloudMode && allWorkersOffline) {
    pillClass = "bg-indigo-950/70 text-indigo-200 border-indigo-700/80 hover:bg-indigo-900/70";
    dotClass = "bg-indigo-400";
    label =
      effectiveApiCount > 0
        ? `Cloud Direct API (${effectiveApiCount} Connected)`
        : "Cloud UI · Direct API Mode";
  } else {
    label = `Degraded (${[
      !health.redis && "Redis",
      !effectiveStealth && "Stealth",
      !health.ffmpeg && "FFmpeg",
    ]
      .filter(Boolean)
      .join(", ")} offline)`;
  }

  return (
    <button
      type="button"
      onClick={() => void fetchHealth()}
      title={
        health.cloudMode && !allOk
          ? companionOnline
            ? "Connected directly from your browser to your running Stealth Companion Worker, plus direct Cloud APIs."
            : "Vercel hosts stateless Direct Cloud APIs & browser-isolated credentials. Connect your Companion Worker (:8001) in Vault for Chrome browser automation."
          : "Click to re-check Redis, Stealth Browser Worker, and FFmpeg health"
      }
      className={`text-[11px] px-2.5 py-0.5 rounded border font-mono flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${pillClass}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
      <span>{checking ? "Refreshing..." : label}</span>
    </button>
  );
}

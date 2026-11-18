"use client";

import React, { useEffect, useState } from "react";
import { getClientCredentials } from "@/lib/client-vault";
import {
  COMPANION_CHANGED_EVENT,
  CREDENTIALS_CHANGED_EVENT,
  detectActiveCompanion,
} from "@/lib/companion-bridge";
import { buildClientApiFlags } from "@/lib/credential-mapping";
import {
  LICENSE_CHANGED_EVENT,
  type StoredLicenseState,
  getClientPlanLicense,
} from "@/lib/plans";

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
  const [activeLicense, setActiveLicense] = useState<StoredLicenseState | null>(null);
  const [checking, setChecking] = useState(false);

  const refreshClientState = () => {
    const flags = buildClientApiFlags(getClientCredentials(), {});
    setClientApiCount(Object.values(flags).filter(Boolean).length);
    setActiveLicense(getClientPlanLicense());
  };

  const fetchHealth = async () => {
    setChecking(true);
    refreshClientState();
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
    const onCredChange = () => refreshClientState();
    const onCompanionChange = () => void fetchHealth();
    const onLicenseChange = () => refreshClientState();
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, onCredChange);
    window.addEventListener(COMPANION_CHANGED_EVENT, onCompanionChange);
    window.addEventListener(LICENSE_CHANGED_EVENT, onLicenseChange);
    const timer = setInterval(() => {
      void fetchHealth();
    }, 30_000);
    return () => {
      window.removeEventListener(CREDENTIALS_CHANGED_EVENT, onCredChange);
      window.removeEventListener(COMPANION_CHANGED_EVENT, onCompanionChange);
      window.removeEventListener(LICENSE_CHANGED_EVENT, onLicenseChange);
      clearInterval(timer);
    };
  }, []);

  if (!health) {
    return (
      <span className="text-[11px] text-[#999999] bg-white font-mono whitespace-nowrap shrink-0">
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
  const tierPrefix = activeLicense
    ? `${activeLicense.planName} ($${activeLicense.priceUsd})`
    : "Free Tier";

  let label = "";
  if (allOk) {
    label = `${tierPrefix} · Stack Online · ${effectiveVaultCount} Vault / ${effectiveApiCount} API`;
  } else if (companionOnline) {
    label = `${tierPrefix} · Cloud UI + Companion · ${effectiveVaultCount} Vault / ${effectiveApiCount} API`;
  } else if (health.cloudMode && allWorkersOffline) {
    label =
      effectiveApiCount > 0
        ? `${tierPrefix} · Cloud Direct API (${effectiveApiCount} Connected)`
        : `${tierPrefix} · Cloud UI · Direct API Mode`;
  } else {
    label = `${tierPrefix} · Degraded (${[
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
      className="text-[11px] px-2.5 py-1 rounded border border-[#cccccc] bg-white text-[#666666] hover:font-bold hover:text-[#333333] font-mono cursor-pointer whitespace-nowrap shrink-0"
    >
      {checking ? "Refreshing..." : label}
    </button>
  );
}

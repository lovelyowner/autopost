"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ACTIVE_PLATFORMS,
  ARCHIVED_PLATFORMS,
  calculateUploadConstraints,
  getPlatform,
  planWaterfall,
  type ScalingMode,
} from "@polypost/platform-registry";
import {
  CAPTION_PROFILES,
  profileForPlatform,
  type CaptionProfile,
} from "@polypost/ai-caption-spinner";
import type { CampaignStateSnapshot } from "@polypost/node-api-worker";
import type { PresetProfile } from "@/lib/config-store";
import {
  AccountConnectModal,
  VAULT_BROWSER_PLATFORMS,
} from "../components/AccountConnectModal";
import { LetterFilterBar, matchesSearchAndLetter } from "../components/LetterFilterBar";
import { OneClickConnectPanel } from "../components/OneClickConnectPanel";
import {
  compressImageInBrowser,
  probeMediaInBrowser,
} from "../components/wasm-media-preprocessor";
import {
  addClientScheduledItems,
  deleteClientPreset,
  getClientCredentials,
  getClientHistory,
  mergePresetsWithClient,
  saveClientHistoryEntry,
  saveClientPreset,
} from "@/lib/client-vault";
import { formatUtcSlotFromMinutes } from "@/lib/schedule-utils";
import {
  COMPANION_CHANGED_EVENT,
  CREDENTIALS_CHANGED_EVENT,
  detectActiveCompanion,
  dispatchCompanionUpload,
  notifyCredentialsChanged,
  stageMediaToCompanion,
} from "@/lib/companion-bridge";
import { buildClientApiFlags } from "@/lib/credential-mapping";
import {
  LICENSE_CHANGED_EVENT,
  type StoredLicenseState,
  evaluateCampaignPlanLimits,
  getClientPlanLicense,
} from "@/lib/plans";
import {
  analyzeSpintax,
  auditCampaignCaptions,
  autoFixPlatformCaption,
  formatResolvedCaptionSheet,
  injectAntiSpamSpintax,
} from "@/lib/caption-preflight";

interface CampaignJob {
  jobId: string;
  platformId: string;
  platformName: string;
  injectedCaption?: string;
  status: string;
  fileSizeMb?: number;
}

interface ActiveCampaign {
  campaignId: string;
  status: string;
  strictLive: boolean;
  queuedInRedis: boolean;
  executedStatelessly?: boolean;
  immediateSnapshot?: CampaignStateSnapshot;
  masterJob: CampaignJob;
  teaserJobs: CampaignJob[];
  timestamp: number;
}

interface ProbeSummary {
  exists: boolean;
  sizeMb?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  recommendedEncoder?: string;
  recommendedStartSec?: number;
  previewStartSec?: number;
  previewDataUrl?: string;
  safetyScan?: {
    available: boolean;
    sensitivityScore?: number;
    framesScanned?: number;
    safeWindow?: { startSec: number; endSec: number } | null;
    reason?: string;
    error?: string;
  };
  error?: string;
}

export default function DashboardPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "youtube",
    "bluesky",
    "x",
    "discord",
    "pornhub_video",
    "fansly_wall",
  ]);
  const [scalingMode, setScalingMode] = useState<ScalingMode>("strict");
  const [masterMb, setMasterMb] = useState<number>(350);
  const [activeQuadrant, setActiveQuadrant] = useState<string>("all");
  const [platformSearch, setPlatformSearch] = useState<string>("");
  const [platformLetter, setPlatformLetter] = useState<string>("all");
  const [showRegistryOnly, setShowRegistryOnly] = useState<boolean>(false);

  // Presets & Vault Accounts Sync
  const [presets, setPresets] = useState<PresetProfile[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [vaultAliases, setVaultAliases] = useState<string[]>([]);
  const [apiCredentials, setApiCredentials] = useState<Record<string, boolean>>({});
  const [accountId, setAccountId] = useState("main_creator");

  // Caption Generator State
  const [topic, setTopic] = useState("Cyberpunk Neon Night Photoshoot");
  const [creatorName, setCreatorName] = useState("StudioNova");
  const [niche, setNiche] = useState("Cyberpunk / Low-light");
  const [priceUsd, setPriceUsd] = useState(14.99);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({});
  const [showPriceOverrides, setShowPriceOverrides] = useState(false);
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, string>>({});
  const [showCaptionOverrides, setShowCaptionOverrides] = useState(false);
  const [existingMasterUrl, setExistingMasterUrl] = useState("");
  const [appendUtm, setAppendUtm] = useState(false);
  const [seedTags, setSeedTags] = useState("neon, cyberpunk, photoshoot, 4k");
  const [spinningCaptions, setSpinningCaptions] = useState(false);
  const [spinSource, setSpinSource] = useState<string | null>(null);

  const [generatedCaptions, setGeneratedCaptions] = useState<Record<CaptionProfile, string>>({
    tube_seo: "Cyberpunk Studio Walkthrough 4K\n\nBehind the scenes look into our neon set.",
    creator_store: "New Cyberpunk Vault Set Live! Unlock all 4K raw photos.\n\n#fyp #exclusive",
    microblog: "Exploring neon saturation and harsh contrast in the studio. {{LIVE_MASTER_URL}}",
    chat_community: "Hey everyone! The new cyberpunk studio gallery is now posted -> {{LIVE_MASTER_URL}}",
    strict_sfw_clean: "Experimental lighting setups in magenta and cyan in the studio.",
  });

  // Media & Funnel State
  const [masterTargetId, setMasterTargetId] = useState("youtube");
  const [cloudMode, setCloudMode] = useState(false);
  const [compressedImageInfo, setCompressedImageInfo] = useState<string | null>(null);
  const [clientImageDataUrl, setClientImageDataUrl] = useState<string | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [mediaPath, setMediaPath] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [stagedUploadInfo, setStagedUploadInfo] = useState<string | null>(null);
  const [showLiveGuide, setShowLiveGuide] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectTab, setConnectTab] = useState<"oneclick" | "browser" | "api">("oneclick");
  const [connectPlatformId, setConnectPlatformId] = useState<string | null>(null);
  const [connectProviderId, setConnectProviderId] = useState<string | null>(null);
  const [accountOverrides, setAccountOverrides] = useState<Record<string, string>>({});
  const [showAccountOverrides, setShowAccountOverrides] = useState(false);
  const [startSec, setStartSec] = useState<number>(0);
  const [staggerSec, setStaggerSec] = useState<number>(0);
  const [delayMinutes, setDelayMinutes] = useState<number>(0);
  const [savingPreset, setSavingPreset] = useState<boolean>(false);
  const [watermarkText, setWatermarkText] = useState<string>("");
  const [watermarkPosition, setWatermarkPosition] = useState<
    "top-left" | "top-right" | "bottom-left" | "bottom-right"
  >("bottom-right");
  const [probeInfo, setProbeInfo] = useState<ProbeSummary | null>(null);
  const [probingMedia, setProbingMedia] = useState(false);

  // Compliance & Execution Settings
  const [recordsId2257, setRecordsId2257] = useState("REC-2257-VAULT-NOVA-2026");
  const [confirmed2257Attestation, setConfirmed2257Attestation] = useState(false);
  const [strictLive, setStrictLive] = useState(false);
  const [simulationDisabled, setSimulationDisabled] = useState(false);
  const [postFirstComment, setPostFirstComment] = useState(true);
  const [firstCommentTemplate, setFirstCommentTemplate] = useState("");
  const [autoReconcile, setAutoReconcile] = useState(true);

  // Notifications & Real-Time SSE Campaign State
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<ActiveCampaign | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<CampaignStateSnapshot | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedAllUrls, setCopiedAllUrls] = useState(false);
  const [activeLicense, setActiveLicense] = useState<StoredLicenseState | null>(null);
  const [runsLast24h, setRunsLast24h] = useState(0);

  useEffect(() => {
    const syncPlanAndUsage = () => {
      setActiveLicense(getClientPlanLicense());
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recent = getClientHistory().filter((h) => (h.createdAt || h.updatedAt || 0) >= cutoff);
      setRunsLast24h(recent.length);
    };
    syncPlanAndUsage();
    window.addEventListener(LICENSE_CHANGED_EVENT, syncPlanAndUsage);
    return () => {
      window.removeEventListener(LICENSE_CHANGED_EVENT, syncPlanAndUsage);
    };
  }, [activeCampaign]);

  const planQuota = useMemo(
    () =>
      evaluateCampaignPlanLimits({
        planId: activeLicense?.planId ?? "free",
        selectedPlatformIds: selectedIds,
        accountOverrides,
        runsLast24h,
      }),
    [activeLicense, selectedIds, accountOverrides, runsLast24h],
  );

  const captionPreflight = useMemo(
    () =>
      auditCampaignCaptions({
        selectedPlatformIds: selectedIds,
        generatedCaptions,
        captionOverrides,
        accountOverrides,
        existingMasterUrl,
      }),
    [selectedIds, generatedCaptions, captionOverrides, accountOverrides, existingMasterUrl],
  );

  const activeSpintaxSummary = useMemo(() => {
    const candidate =
      Object.values(captionOverrides).find((v) => /(?<!\{)\{[^{}|]+\|[^{}]+\}(?!\})/.test(v || "")) ||
      Object.values(generatedCaptions).find((v) => /(?<!\{)\{[^{}|]+\|[^{}]+\}(?!\})/.test(v || "")) ||
      generatedCaptions.microblog ||
      "";
    return analyzeSpintax(candidate, 3);
  }, [captionOverrides, generatedCaptions]);

  const handleAutoFixCaptions = () => {
    const nextOverrides: Record<string, string> = { ...captionOverrides };
    let fixedCount = 0;
    for (const item of captionPreflight.items) {
      if (!item.overLimit && !item.strictViolation) continue;
      const pl = getPlatform(item.platformId);
      nextOverrides[item.platformId] = autoFixPlatformCaption(
        item.rawCaption,
        pl,
        existingMasterUrl,
      );
      fixedCount++;
    }
    if (fixedCount > 0) {
      setCaptionOverrides(nextOverrides);
      setShowCaptionOverrides(true);
      setBanner({
        kind: "ok",
        text: `Auto-fitted & cleaned captions for ${fixedCount} platform(s) into Per-Platform Caption Overrides.`,
      });
    }
  };

  const [preflightCopyStatus, setPreflightCopyStatus] = useState("");
  const [queuingToCalendar, setQueuingToCalendar] = useState(false);

  const handleInjectSpintaxAllProfiles = () => {
    const next: Record<CaptionProfile, string> = { ...generatedCaptions };
    for (const prof of CAPTION_PROFILES) {
      next[prof] = injectAntiSpamSpintax(next[prof] || "", prof);
    }
    setGeneratedCaptions(next);
    setBanner({
      kind: "ok",
      text: "Injected 16+ anti-spam spintax permutations across all 5 caption profiles.",
    });
  };

  const handleCopyCaptionSheet = async () => {
    const sheet = formatResolvedCaptionSheet(captionPreflight.items, existingMasterUrl);
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(sheet);
      setPreflightCopyStatus(`Copied ${captionPreflight.items.length} platform captions`);
    } catch {
      setPreflightCopyStatus("Copy failed");
    }
    setTimeout(() => setPreflightCopyStatus(""), 2000);
  };

  const handleSaveToCalendarQueue = async () => {
    if (selectedIds.length === 0) {
      setBanner({ kind: "err", text: "Select at least one target platform before scheduling." });
      return;
    }
    const offsetMin = delayMinutes > 0 ? delayMinutes : 60;
    const targetMinutes = Math.floor((Date.now() + offsetMin * 60_000) / 60_000);
    const slot = formatUtcSlotFromMinutes(targetMinutes);
    const newItem = {
      id: `sched_${Date.now()}_0`,
      title: topic.trim() || "Scheduled PolyPost Drop",
      date: slot.date,
      time: slot.time,
      platforms: selectedIds,
      masterPlatformId: masterTargetId || selectedIds[0],
      mediaPath: mediaPath.trim() || undefined,
      accountId: accountId.trim() || "default",
      status: "scheduled" as const,
      createdAt: Date.now(),
    };
    setQueuingToCalendar(true);
    try {
      addClientScheduledItems([newItem]);
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [newItem],
          enqueueInRedis: true,
          confirmed2257Attestation,
          recordsId2257,
          strictLive,
        }),
      }).catch(() => {});
      setBanner({
        kind: "ok",
        text: `Queued '${newItem.title}' for ${slot.date} at ${slot.time} across ${selectedIds.length} platform(s). View or stagger in Calendar (Alt+4).`,
      });
    } finally {
      setQueuingToCalendar(false);
    }
  };

  const refreshCredentialsStatus = async (preferredAlias?: string) => {
    try {
      const [r, companion] = await Promise.all([
        fetch("/api/credentials/status"),
        detectActiveCompanion(),
      ]);
      if (!r.ok) return;
      const data = await r.json();
      setCloudMode(Boolean(data.cloudMode));
      const serverAliases: string[] = (data.vaultedProfiles || []).map((p: any) => p.account_id).filter(Boolean);
      const companionAliases: string[] = (companion?.profiles || []).map((p: any) => p.account_id).filter(Boolean);
      const aliases = Array.from(new Set([...serverAliases, ...companionAliases]));
      setVaultAliases(aliases);
      setApiCredentials(buildClientApiFlags(getClientCredentials(), data.apiCredentials || {}));
      if (preferredAlias && aliases.includes(preferredAlias)) {
        setAccountId(preferredAlias);
      } else if (aliases.length > 0 && accountId === "main_creator" && !aliases.includes("main_creator")) {
        setAccountId(aliases[0]);
      }
      if (data.services?.simulationDisabled) {
        setSimulationDisabled(true);
        setStrictLive(true);
      }
    } catch {}
  };

  const openConnectForPlatform = (pl?: { id: string; connector?: string; transport?: string; support?: string }) => {
    if (!pl) {
      setConnectTab("api");
      setConnectPlatformId(null);
      setConnectProviderId("bluesky");
      setConnectModalOpen(true);
      return;
    }
    const connectorMap: Record<string, string> = {
      bluesky: "bluesky",
      mastodon: "mastodon",
      misskey: "misskey",
      lemmy: "lemmy",
      tumblr: "tumblr",
      nostr: "nostr",
      matrix: "matrix",
      farcaster: "farcaster",
      wordpress: "wordpress",
      devto: "devto",
      revolt: "revolt",
      stoat: "revolt",
      vk: "vk",
      telegram: "telegram",
      discord_webhook: "discord",
      generic_webhook: "fluxer",
      fluxer: "fluxer",
      slack_webhook: "slack",
      reddit: "reddit",
      e621: "e621",
      deviantart: "deviantart",
      inkbunny: "inkbunny",
      peertube: "peertube",
      tus_s3_chunked: "peertube",
      x: "x",
      youtube: "google",
    };
    const vaultSupportedIds = new Set(VAULT_BROWSER_PLATFORMS.map((vp) => vp.id));
    const isBrowser =
      pl.transport === "patchright_stealth" ||
      pl.support === "sau_browser" ||
      vaultSupportedIds.has(pl.id);
    if (!isBrowser && pl.connector && connectorMap[pl.connector]) {
      setConnectTab("api");
      setConnectPlatformId(null);
      setConnectProviderId(connectorMap[pl.connector]);
    } else if ((pl.id === "x" || pl.id === "youtube") && pl.connector && connectorMap[pl.connector]) {
      setConnectTab("api");
      setConnectPlatformId(pl.id);
      setConnectProviderId(connectorMap[pl.connector]);
    } else {
      setConnectTab("browser");
      setConnectPlatformId(pl.id);
      setConnectProviderId(null);
    }
    setConnectModalOpen(true);
  };

  const getPlatformConnectionState = (pl: {
    id: string;
    connector?: string;
    transport?: string;
    support?: string;
  }): { connected: boolean; label: string } => {
    const apiKeyMap: Record<string, string> = {
      bluesky: "bluesky",
      mastodon: "mastodon",
      misskey: "misskey",
      lemmy: "lemmy",
      tumblr: "tumblr",
      nostr: "nostr",
      matrix: "matrix",
      farcaster: "farcaster",
      wordpress: "wordpress",
      devto: "devto",
      revolt: "revolt",
      stoat: "revolt",
      vk: "vk",
      telegram: "telegram",
      discord_webhook: "discord",
      generic_webhook: "fluxer",
      fluxer: "fluxer",
      slack_webhook: "slack",
      reddit: "reddit",
      e621: "e621",
      deviantart: "deviantart",
      inkbunny: "inkbunny",
      peertube: "peertube",
      tus_s3_chunked: "peertube",
      x: "x",
      youtube: "google",
    };
    const apiKeyName = pl.connector ? apiKeyMap[pl.connector] : undefined;
    if (apiKeyName && apiCredentials[apiKeyName]) {
      return { connected: true, label: "API OK" };
    }
    const vaultSupportedIds = new Set(VAULT_BROWSER_PLATFORMS.map((vp) => vp.id));
    const isBrowser =
      pl.transport === "patchright_stealth" ||
      pl.support === "sau_browser" ||
      vaultSupportedIds.has(pl.id);
    if (isBrowser) {
      const rawTarget = (accountOverrides[pl.id] || accountId).trim();
      const targetList = rawTarget
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const matchedCount = targetList.filter((a) => vaultAliases.includes(a)).length;
      if (matchedCount > 1) {
        return { connected: true, label: `VAULT ×${matchedCount}` };
      }
      const ok = matchedCount === 1 || vaultAliases.length > 0;
      return ok ? { connected: true, label: "VAULT" } : { connected: false, label: "LOGIN" };
    }
    if (apiKeyName) {
      return { connected: false, label: "ADD KEY" };
    }
    return { connected: false, label: "DEMO" };
  };

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((data) => {
        const list = mergePresetsWithClient(data.presets || []);
        setPresets(list);
        if (list.length > 0) {
          setSelectedPresetId(list[0].id);
          setRecordsId2257(list[0].recordsId2257);
          setPriceUsd(list[0].ppvPriceUsd);
          setSeedTags(list[0].seoTags.join(", "));
        }
      })
      .catch(() => {
        const localOnly = mergePresetsWithClient([]);
        setPresets(localOnly);
      });

    void refreshCredentialsStatus();
    const onCredOrCompanionChange = () => void refreshCredentialsStatus();
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, onCredOrCompanionChange);
    window.addEventListener(COMPANION_CHANGED_EVENT, onCredOrCompanionChange);

    const params = new URLSearchParams(window.location.search);
    const rerunId = params.get("rerun");
    const failedOnly = params.get("failedOnly") === "1";
    if (rerunId) {
      fetch(`/api/campaigns/history?campaignId=${encodeURIComponent(rerunId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const entry =
            data?.entry || getClientHistory().find((h) => h.campaignId === rerunId) || null;
          if (!entry) return;
          if (entry.topic) setTopic(entry.topic);
          if (entry.masterPlatformId && entry.masterPlatformId !== "unknown") {
            setMasterTargetId(entry.masterPlatformId);
          }
          if (entry.accountId) setAccountId(entry.accountId);
          if (entry.mediaPath) setMediaPath(entry.mediaPath);
          if (entry.existingMasterUrl) setExistingMasterUrl(entry.existingMasterUrl);
          if (entry.firstCommentTemplate) setFirstCommentTemplate(entry.firstCommentTemplate);
          if (entry.priceOverrides && typeof entry.priceOverrides === "object") {
            const stringifiedPrices: Record<string, string> = {};
            for (const [k, v] of Object.entries(entry.priceOverrides)) {
              stringifiedPrices[k] = String(v);
            }
            setPriceOverrides(stringifiedPrices);
            if (Object.keys(stringifiedPrices).length > 0) setShowPriceOverrides(true);
          }
          if (!failedOnly && entry.accountOverrides && typeof entry.accountOverrides === "object") {
            setAccountOverrides(entry.accountOverrides);
            if (Object.keys(entry.accountOverrides).length > 0) setShowAccountOverrides(true);
          }
          const allTeasers: any[] = entry.teasers || [];
          const targetTeasers = failedOnly
            ? allTeasers.filter((t: any) => t.status === "failed")
            : allTeasers;
          const ids = [
            entry.masterPlatformId,
            ...targetTeasers.map((t: any) => t.platformId),
          ].filter(Boolean);
          if (ids.length > 0) setSelectedIds(Array.from(new Set(ids)));

          if (failedOnly && targetTeasers.length > 0) {
            const perPlat: Record<string, string[]> = {};
            for (const ft of targetTeasers) {
              const alias =
                ft.accountId ||
                (typeof ft.platformName === "string" && ft.platformName.includes("(@")
                  ? ft.platformName.split("(@")[1]?.replace(/\).*$/, "").trim()
                  : "") ||
                entry.accountId ||
                "default";
              if (!perPlat[ft.platformId]) perPlat[ft.platformId] = [];
              if (!perPlat[ft.platformId].includes(alias)) perPlat[ft.platformId].push(alias);
            }
            const nextOverrides: Record<string, string> = {};
            for (const [pid, list] of Object.entries(perPlat)) {
              nextOverrides[pid] = list.join(", ");
            }
            setAccountOverrides(nextOverrides);
            setShowAccountOverrides(true);
            setBanner({
              kind: "info",
              text: `Loaded ONLY the ${targetTeasers.length} failed target(s) from '${entry.topic}' for selective retry.`,
            });
          } else {
            setBanner({
              kind: "info",
              text: `Loaded campaign '${entry.topic}' (${entry.campaignId}) into Composer.`,
            });
          }
        })
        .catch(() => {});
    }

    const scheduledTitle = params.get("scheduledTitle");
    if (scheduledTitle) {
      setTopic(scheduledTitle);
      const sp = (params.get("scheduledPlatforms") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (sp.length > 0) setSelectedIds(sp);
      const sm = params.get("scheduledMaster");
      if (sm) setMasterTargetId(sm);
      const sa = params.get("scheduledAccount");
      if (sa) setAccountId(sa);
      const smedia = params.get("scheduledMedia");
      if (smedia) setMediaPath(smedia);
      setBanner({
        kind: "info",
        text: `Loaded scheduled campaign '${scheduledTitle}' from Calendar into Composer.`,
      });
    }

    return () => {
      window.removeEventListener(CREDENTIALS_CHANGED_EVENT, onCredOrCompanionChange);
      window.removeEventListener(COMPANION_CHANGED_EVENT, onCredOrCompanionChange);
    };
  }, []);

  const applyPreset = (id: string, list: PresetProfile[] = presets) => {
    setSelectedPresetId(id);
    const hit = list.find((p) => p.id === id);
    if (!hit) return;
    setRecordsId2257(hit.recordsId2257);
    setPriceUsd(hit.ppvPriceUsd);
    setSeedTags(hit.seoTags.join(", "));
    setWatermarkPosition(hit.watermarkPosition || "bottom-right");
    if (hit.masterPlatformId) setMasterTargetId(hit.masterPlatformId);
    if (Array.isArray(hit.targetPlatforms) && hit.targetPlatforms.length > 0) {
      setSelectedIds(hit.targetPlatforms);
    }
    if (hit.accountId) setAccountId(hit.accountId);
    if (hit.accountOverrides && typeof hit.accountOverrides === "object") {
      setAccountOverrides(hit.accountOverrides);
      if (Object.keys(hit.accountOverrides).length > 0) {
        setShowAccountOverrides(true);
      }
    }
    if (hit.priceOverrides && typeof hit.priceOverrides === "object") {
      setPriceOverrides(hit.priceOverrides);
      setShowPriceOverrides(Object.keys(hit.priceOverrides).length > 0);
    } else {
      setPriceOverrides({});
    }
    if (hit.captionOverrides && typeof hit.captionOverrides === "object") {
      setCaptionOverrides(hit.captionOverrides);
      setShowCaptionOverrides(Object.keys(hit.captionOverrides).length > 0);
    } else {
      setCaptionOverrides({});
    }
    setFirstCommentTemplate(hit.firstCommentTemplate || "");
    setExistingMasterUrl(hit.existingMasterUrl || "");
    if (typeof hit.staggerSec === "number") {
      setStaggerSec(hit.staggerSec);
    }
    setBanner({
      kind: "ok",
      text: `Applied preset '${hit.name}' (2257 ID, PPV price, platform matrix, multi-account overrides, and ${hit.seoTags.length} SEO tags synced).`,
    });
  };

  const handleSaveCurrentMatrixAsPreset = async () => {
    setSavingPreset(true);
    try {
      const parsedTags = seedTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const presetName = `${topic.slice(0, 24).trim() || "Custom"} Matrix (${selectedIds.length} targets)`;
      const draftPreset: PresetProfile = {
        id: `preset_${Date.now()}`,
        name: presetName,
        recordsId2257,
        custodianContact: "custodian@example.com",
        ppvPriceUsd: priceUsd,
        watermarkPngPath: "/watermarks/logo.png",
        watermarkPosition,
        seoTags: parsedTags,
        masterPlatformId: masterTargetId,
        targetPlatforms: selectedIds,
        accountId,
        accountOverrides,
        priceOverrides,
        captionOverrides,
        firstCommentTemplate: firstCommentTemplate.trim() || undefined,
        existingMasterUrl: existingMasterUrl.trim() || undefined,
        staggerSec,
      };

      try {
        const res = await fetch("/api/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftPreset),
        });
        if (res.ok) {
          const data = await res.json();
          const merged = mergePresetsWithClient(data.presets || presets);
          setPresets(merged);
          if (data.saved?.id) setSelectedPresetId(data.saved.id);
          setBanner({
            kind: "ok",
            text: `Saved current platform & multi-account roster as preset '${presetName}'.`,
          });
          return;
        }
      } catch {
        // Fall through to browser localStorage persistence on serverless deployments
      }

      saveClientPreset(draftPreset);
      setPresets((prev) => mergePresetsWithClient(prev));
      setSelectedPresetId(draftPreset.id);
      setBanner({
        kind: "ok",
        text: `Saved preset '${presetName}' privately in your browser vault (localStorage).`,
      });
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message || "Could not save preset." });
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeleteSelectedPreset = async () => {
    if (!selectedPresetId || presets.length <= 1) return;
    const target = presets.find((p) => p.id === selectedPresetId);
    deleteClientPreset(selectedPresetId);
    try {
      const res = await fetch(`/api/presets?id=${encodeURIComponent(selectedPresetId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        const merged = mergePresetsWithClient(data.presets || []);
        setPresets(merged);
        if (merged[0]) applyPreset(merged[0].id, merged);
      } else {
        const next = presets.filter((p) => p.id !== selectedPresetId);
        setPresets(next);
        if (next[0]) applyPreset(next[0].id, next);
      }
      setBanner({
        kind: "info",
        text: `Deleted preset '${target?.name || selectedPresetId}'.`,
      });
    } catch {
      const next = presets.filter((p) => p.id !== selectedPresetId);
      setPresets(next);
      if (next[0]) applyPreset(next[0].id, next);
      setBanner({
        kind: "info",
        text: `Removed preset '${target?.name || selectedPresetId}' from browser vault.`,
      });
    }
  };

  const constraints = useMemo(() => {
    return calculateUploadConstraints(selectedIds, scalingMode);
  }, [selectedIds, scalingMode]);

  const waterfallPlan = useMemo(() => {
    return planWaterfall(masterMb, selectedIds);
  }, [masterMb, selectedIds]);

  const availablePlatformLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const p of ACTIVE_PLATFORMS) {
      if (activeQuadrant !== "all" && p.quadrant !== activeQuadrant) continue;
      const first = p.name.trim().charAt(0).toUpperCase();
      if (first) letters.add(first);
    }
    return letters;
  }, [activeQuadrant]);

  const filteredPlatforms = useMemo(() => {
    const q = platformSearch.trim().toLowerCase();
    return ACTIVE_PLATFORMS.filter((p) => {
      if (activeQuadrant !== "all" && p.quadrant !== activeQuadrant) return false;
      const isLiveCapable =
        p.support !== "registry_only" ||
        VAULT_BROWSER_PLATFORMS.some((vp) => vp.id === p.id) ||
        selectedIds.includes(p.id);
      if (!showRegistryOnly && !q && platformLetter === "all" && !isLiveCapable) return false;
      return matchesSearchAndLetter(p.name, p.id, q, platformLetter, p.url);
    });
  }, [activeQuadrant, platformSearch, platformLetter, showRegistryOnly, selectedIds]);

  const requires2257 = useMemo(() => {
    const ids = new Set([masterTargetId, ...selectedIds]);
    return Array.from(ids).some((id) => getPlatform(id).requiresAdultTaxonomy);
  }, [masterTargetId, selectedIds]);

  const fanOutSummary = useMemo(() => {
    const parseAliases = (raw: string | undefined, fallback: string): string[] => {
      const src = raw && raw.trim() ? raw : fallback;
      const list = Array.from(
        new Set(
          String(src || "default")
            .split(",")
            .map((s) => s.trim().split(":")[0].trim())
            .filter(Boolean),
        ),
      );
      return list.length > 0 ? list : ["default"];
    };
    const isTeaserOnly = Boolean(existingMasterUrl.trim());
    const teaserPlatforms = isTeaserOnly
      ? selectedIds
      : selectedIds.filter((id) => id !== masterTargetId);
    const uniqueAccounts = new Set<string>();
    let teaserJobs = 0;

    if (!isTeaserOnly) {
      const mAliases = parseAliases(accountOverrides[masterTargetId], accountId);
      mAliases.forEach((a) => uniqueAccounts.add(a));
      if (mAliases.length > 1) {
        teaserJobs += mAliases.length - 1;
      }
    }

    for (const tid of teaserPlatforms) {
      const tAliases = parseAliases(accountOverrides[tid], accountId);
      tAliases.forEach((a) => uniqueAccounts.add(a));
      teaserJobs += tAliases.length;
    }

    return {
      isTeaserOnly,
      masterJobs: isTeaserOnly ? 0 : 1,
      teaserJobs,
      totalPlatforms: isTeaserOnly
        ? selectedIds.length
        : new Set([masterTargetId, ...selectedIds]).size,
      uniqueAccountsCount: uniqueAccounts.size,
    };
  }, [selectedIds, masterTargetId, accountId, accountOverrides, existingMasterUrl]);

  const togglePlatform = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const resolveWatermarkText = () =>
    watermarkText
      .trim()
      .replace(/\{\{\s*ACCOUNT(?:_ID)?\s*\}\}/gi, accountId.split(",")[0]?.trim() || "creator");

  const handleClientCompression = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStagedFile(file);
    try {
      const wm = resolveWatermarkText();
      const res = await compressImageInBrowser(file, 1000 * 1024, 2048, wm, watermarkPosition);
      setClientImageDataUrl(res.dataUrl);
      setProbeInfo({
        exists: true,
        sizeMb: Number((res.sizeBytes / (1024 * 1024)).toFixed(2)),
        durationSec: 0,
        width: res.width,
        height: res.height,
        previewDataUrl: res.dataUrl,
      });
      setCompressedImageInfo(
        `WASM Optimized${wm ? " + Watermarked" : ""}: ${(res.sizeBytes / 1024).toFixed(1)} KB (${res.width}x${res.height} ${res.format}) — ready for Bluesky & cloud direct APIs`,
      );
    } catch (err: any) {
      setCompressedImageInfo(`Compression failed: ${err.message}`);
    }
  };

  const handleProbeMedia = async (customStartSec?: number, scanSafety = true, overridePath?: string) => {
    const targetPath = (overridePath ?? mediaPath).trim();
    const targetSeek = customStartSec ?? startSec;
    if ((!targetPath || cloudMode) && stagedFile) {
      setProbingMedia(true);
      try {
        const localProbe = await probeMediaInBrowser(
          stagedFile,
          targetSeek,
          resolveWatermarkText(),
          watermarkPosition,
        );
        setProbeInfo({
          exists: true,
          sizeMb: localProbe.sizeMb,
          durationSec: localProbe.durationSec,
          width: localProbe.width,
          height: localProbe.height,
          previewDataUrl: localProbe.previewDataUrl,
        });
        if (localProbe.sizeMb) setMasterMb(Math.max(1, Math.ceil(localProbe.sizeMb)));
      } catch (err: any) {
        setProbeInfo({ exists: false, error: err.message });
      } finally {
        setProbingMedia(false);
      }
      return;
    }

    if (!targetPath) return;
    setProbingMedia(true);
    try {
      const res = await fetch("/api/media/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: targetPath,
          startSec: targetSeek,
          extractPreview: true,
          scanSafety,
        }),
      });
      const data: ProbeSummary = await res.json();
      setProbeInfo(data);
      if (data.exists && data.sizeMb) {
        setMasterMb(Math.max(1, Math.ceil(data.sizeMb)));
      }
      if (customStartSec === undefined && typeof data.recommendedStartSec === "number") {
        setStartSec(data.recommendedStartSec);
      }
    } catch (err: any) {
      setProbeInfo({ exists: false, error: err.message });
    } finally {
      setProbingMedia(false);
    }
  };

  const handleStageMediaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    setStagedUploadInfo(null);
    setStagedFile(file);

    const wm = resolveWatermarkText();
    let localProbePreview: string | undefined;
    let localDims: { width: number; height: number; durationSec: number; sizeMb: number } | null = null;
    try {
      const localProbe = await probeMediaInBrowser(file, startSec, wm, watermarkPosition);
      localProbePreview = localProbe.previewDataUrl;
      localDims = {
        width: localProbe.width,
        height: localProbe.height,
        durationSec: localProbe.durationSec,
        sizeMb: localProbe.sizeMb,
      };
      if (localProbe.sizeMb) setMasterMb(Math.max(1, Math.ceil(localProbe.sizeMb)));
      setProbeInfo({
        exists: true,
        sizeMb: localProbe.sizeMb,
        durationSec: localProbe.durationSec,
        width: localProbe.width,
        height: localProbe.height,
        previewDataUrl: localProbe.previewDataUrl,
      });
    } catch {
      // Fall back to server probe if codec isn't natively decodable in browser
    }

    if (file.type.startsWith("image/")) {
      try {
        const comp = await compressImageInBrowser(file, 1000 * 1024, 2048, wm, watermarkPosition);
        setClientImageDataUrl(comp.dataUrl);
        setCompressedImageInfo(
          `Cloud-Ready Image: ${(comp.sizeBytes / 1024).toFixed(1)} KB (${comp.width}x${comp.height} ${comp.format})`,
        );
      } catch {
        setClientImageDataUrl(null);
      }
    } else {
      setClientImageDataUrl(null);
    }

    if (cloudMode) {
      const companion = await detectActiveCompanion();
      if (companion) {
        try {
          const staged = await stageMediaToCompanion(companion.url, file);
          setMediaPath(staged.filePath);
          setStagedUploadInfo(
            `Staged locally via Companion (:8001): '${staged.originalName}' (${staged.sizeMb} MB) -> ${staged.filePath}`,
          );
          if (staged.sizeMb) setMasterMb(Math.max(1, Math.ceil(staged.sizeMb)));
          setUploadingMedia(false);
          return;
        } catch {
          // Fall through to browser-only / Vercel staging if companion staging fails
        }
      }
      if (file.size > 4 * 1024 * 1024) {
        setMediaPath("");
        setStagedUploadInfo(
          `Browser-probed '${file.name}' (${(file.size / (1024 * 1024)).toFixed(2)} MB) locally — skipped >4MB Vercel upload. Start local Companion (\`npm run companion\`) to stage videos locally or post text/link teasers.`,
        );
        setUploadingMedia(false);
        return;
      }
    }

    try {
      const res = await fetch(`/api/media/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Upload failed");
      }
      setMediaPath(data.filePath);
      setStagedUploadInfo(`Staged '${data.originalName}' (${data.sizeMb} MB) cleanly -> ${data.filePath}`);
      if (data.sizeMb) setMasterMb(data.sizeMb);

      const probeRes = await fetch("/api/media/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: data.filePath,
          startSec,
          extractPreview: true,
          scanSafety: !cloudMode,
        }),
      });
      if (probeRes.ok) {
        const serverProbe: ProbeSummary = await probeRes.json();
        setProbeInfo({
          ...serverProbe,
          previewDataUrl: serverProbe.previewDataUrl || localProbePreview,
          width: serverProbe.width || localDims?.width,
          height: serverProbe.height || localDims?.height,
          durationSec: serverProbe.durationSec || localDims?.durationSec,
        });
      }
    } catch (err: any) {
      if (!localDims) {
        setBanner({ kind: "err", text: `Media staging failed: ${err.message}` });
      }
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleSpinCaptions = async () => {
    setSpinningCaptions(true);
    setSpinSource(null);
    try {
      const res = await fetch("/api/captions/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          creatorName,
          niche,
          priceUsd,
          seedTags,
          credentials: getClientCredentials(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Caption spin failed");
      setGeneratedCaptions(data.captions);
      setSpinSource(data.source);
    } catch (err: any) {
      setBanner({ kind: "err", text: `Caption generation error: ${err.message}` });
    } finally {
      setSpinningCaptions(false);
    }
  };

  const handleLaunchCampaign = async () => {
    setBanner(null);
    if (requires2257 && !confirmed2257Attestation) {
      setBanner({
        kind: "err",
        text: "18 U.S.C. 2257 Compliance Gate: Check the attestation box to confirm custodian records before launching to adult destinations.",
      });
      return;
    }

    const masterDef = getPlatform(masterTargetId);
    if (
      !existingMasterUrl.trim() &&
      (strictLive || simulationDisabled) &&
      !masterDef.textOnly &&
      !mediaPath.trim() &&
      !clientImageDataUrl
    ) {
      setBanner({
        kind: "err",
        text: `Strict Live Mode: Stage an image/video file above (or provide an Existing Master / Link-in-Bio URL below) before uploading to ${masterDef.name}.`,
      });
      return;
    }

    setIsLaunching(true);
    setCopiedUrl(false);

    try {
      const teaserIds = existingMasterUrl.trim()
        ? selectedIds
        : selectedIds.filter((id) => id !== masterTargetId);
      const parsedTags = seedTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const mergedCaptions: Record<string, string> = { ...generatedCaptions };
      for (const [pid, customCap] of Object.entries(captionOverrides)) {
        if (customCap && customCap.trim()) {
          mergedCaptions[pid] = customCap.trim();
        }
      }

      const activeCompanion = cloudMode ? await detectActiveCompanion() : null;
      const isBrowserPlatform = (pid: string) => {
        const pl = getPlatform(pid);
        return pl.transport === "patchright_stealth" || pl.support === "sau_browser";
      };

      let effectiveExistingMasterUrl = existingMasterUrl.trim();
      let companionMasterSimulated = false;
      const effectiveStrict = Boolean(strictLive || simulationDisabled);

      if (cloudMode && activeCompanion && !effectiveExistingMasterUrl && isBrowserPlatform(masterTargetId)) {
        const masterProfile = profileForPlatform(masterDef);
        const primaryMasterAlias =
          (accountOverrides[masterTargetId] || accountId || "main_creator")
            .split(",")[0]
            .split("#")[0]
            .split("|")[0]
            .trim() || "main_creator";
        const masterRes = await dispatchCompanionUpload(activeCompanion.url, {
          jobId: `camp_${Date.now()}_master`,
          accountId: primaryMasterAlias,
          platformId: masterTargetId,
          filePath: mediaPath,
          mediaDataUrl: clientImageDataUrl || undefined,
          title: topic,
          description:
            mergedCaptions[masterTargetId] ||
            mergedCaptions[masterProfile] ||
            mergedCaptions.tube_seo ||
            topic,
          tags: parsedTags,
          dryRun: !effectiveStrict,
          confirmed2257Attestation,
          recordsId2257: recordsId2257.trim() || undefined,
        });
        if (!masterRes.success || !masterRes.publishedUrl) {
          throw new Error(
            masterRes.error || `Local Companion master upload failed on ${masterDef.name}.`,
          );
        }
        effectiveExistingMasterUrl = masterRes.publishedUrl;
        companionMasterSimulated = Boolean(masterRes.simulated);
      }

      const res = await fetch("/api/campaigns/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterPlatformId: masterTargetId,
          teaserPlatformIds: teaserIds,
          masterMb,
          topic,
          captions: mergedCaptions,
          mediaPath,
          mediaDataUrl: clientImageDataUrl || undefined,
          clientCredentials: getClientCredentials(),
          accountId,
          accountOverrides,
          tags: parsedTags,
          confirmed2257Attestation,
          recordsId2257,
          strictLive,
          postFirstComment,
          firstCommentTemplate: firstCommentTemplate.trim() || undefined,
          autoReconcile,
          startSec,
          staggerSec,
          delayMinutes,
          priceUsd,
          priceOverrides,
          appendUtm,
          existingMasterUrl: effectiveExistingMasterUrl || undefined,
          companionMasterSimulated,
          deferBrowserTeasersToCompanion: Boolean(activeCompanion),
          watermark: watermarkText.trim()
            ? { text: watermarkText.trim(), position: watermarkPosition }
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.immediateSnapshot) {
          setLiveSnapshot(data.immediateSnapshot);
          saveClientHistoryEntry(data.immediateSnapshot);
        }
        throw new Error(data.message || data.error || "Failed to launch campaign.");
      }

      let finalSnapshot: CampaignStateSnapshot | null = data.immediateSnapshot || null;
      if (
        finalSnapshot &&
        activeCompanion &&
        finalSnapshot.teasers.some((t) => t.status === "queued" && isBrowserPlatform(t.platformId))
      ) {
        setLiveSnapshot(finalSnapshot);
        const resolvedTeasers = await Promise.all(
          finalSnapshot.teasers.map(async (t) => {
            if (t.status !== "queued" || !isBrowserPlatform(t.platformId)) return t;
            const cRes = await dispatchCompanionUpload(activeCompanion.url, {
              jobId: t.jobId,
              accountId: t.accountId || accountId,
              platformId: t.platformId,
              filePath: mediaPath,
              mediaDataUrl: clientImageDataUrl || undefined,
              title: topic,
              description: t.injectedCaption || topic,
              tags: parsedTags,
              dryRun: !effectiveStrict,
              confirmed2257Attestation,
              recordsId2257: recordsId2257.trim() || undefined,
            });
            return {
              ...t,
              status: cRes.success ? ("published" as const) : ("failed" as const),
              publishedUrl: cRes.publishedUrl,
              simulated: cRes.simulated,
              failureScreenshot: cRes.failureScreenshot,
              error: cRes.error,
            };
          }),
        );
        const anyOk = resolvedTeasers.some((t) => t.status === "published");
        const allErr = resolvedTeasers.length > 0 && !anyOk;
        finalSnapshot = {
          ...finalSnapshot,
          step: allErr ? "failed" : "completed",
          uploadPercent: 100,
          teasers: resolvedTeasers,
          updatedAt: Date.now(),
        };
      }

      if (finalSnapshot) {
        setLiveSnapshot(finalSnapshot);
        saveClientHistoryEntry(finalSnapshot);
        setActiveCampaign({
          ...data,
          status: finalSnapshot.step,
          immediateSnapshot: finalSnapshot,
        });
      } else {
        setLiveSnapshot(null);
        setActiveCampaign(data);
      }
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message });
    } finally {
      setIsLaunching(false);
    }
  };

  // Real-time Server-Sent Events (SSE) subscription for active BullMQ funnel progress
  useEffect(() => {
    if (!activeCampaign) return;
    if (
      activeCampaign.immediateSnapshot &&
      (activeCampaign.immediateSnapshot.step === "completed" ||
        activeCampaign.immediateSnapshot.step === "failed")
    ) {
      return;
    }
    const es = new EventSource(`/api/campaigns/${encodeURIComponent(activeCampaign.campaignId)}/events`);
    es.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as CampaignStateSnapshot;
        setLiveSnapshot(snapshot);
        if (snapshot.step === "completed" || snapshot.step === "failed") {
          saveClientHistoryEntry(snapshot);
          es.close();
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [activeCampaign]);

  const currentStep = liveSnapshot?.step ?? "uploading_master";
  const uploadPercent = liveSnapshot?.uploadPercent ?? 10;
  const teaserStates = liveSnapshot?.teasers ?? activeCampaign?.teaserJobs ?? [];
  const publishedCount = teaserStates.filter((t) => t.status === "published").length;

  return (
    <>
      <AccountConnectModal
        open={connectModalOpen}
        initialTab={connectTab}
        initialPlatformId={connectPlatformId}
        initialProviderId={connectProviderId}
        initialAlias={accountId}
        vaultAliases={vaultAliases}
        onClose={() => setConnectModalOpen(false)}
        onConnected={(newAlias) => void refreshCredentialsStatus(newAlias)}
      />
      <div className="ui-grid-3 relative">
      {/* Row 1: Important Top Banner & Preset Sync (2 cols) + Live Plan Tier & Cap Telemetry (1 col) */}
      <div className="md:col-span-2 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#333333] mb-1">
            Unified Autoposting Composer &amp; Funnel Engine
          </h1>
          <p className="text-xs text-[#999999]">
            Targeting {ACTIVE_PLATFORMS.length} active destinations across 4 quadrants ({ARCHIVED_PLATFORMS.length} discontinued archived) with reactive size ceilings, local AI caption spinning, and real-time BullMQ funnel SSE tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[5px]">
          <button
            type="button"
            onClick={() => openConnectForPlatform()}
            className="border px-3 py-1.5 rounded bg-white text-[#333333] text-xs font-bold cursor-pointer whitespace-nowrap border-[#cccccc] hover:font-bold"
          >
            + Add / Connect Accounts
          </button>

          {/* Preset Selector Sync */}
          {presets.length > 0 && (
            <div className="min-w-[240px] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] text-[#999999] font-medium block">
                  Roster &amp; 2257 Preset:
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSaveCurrentMatrixAsPreset}
                    disabled={savingPreset}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white border text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                  >
                    {savingPreset ? "Saving..." : "+ Save Matrix"}
                  </button>
                  {presets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteSelectedPreset()}
                      title="Delete currently selected preset"
                      className="text-[10px] px-1.5 py-0.5 rounded bg-white border text-[#666666] hover:text-[#333333] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <select
                value={selectedPresetId}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full bg-white px-2.5 py-1 text-xs text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Column 4: Live Plan Tier & Multi-Account Safety Cap Telemetry (1 col) */}
      <div className="md:col-span-1 bg-white flex flex-col justify-between gap-2 text-xs">
        <div className="space-y-1 text-[#666666]">
          <div className="flex items-center justify-between">
            <span>Active Plan:</span>
            <strong className="text-[#333333]">
              {planQuota.effectivePlan.name} (${planQuota.effectivePlan.priceUsd}/mo)
            </strong>
          </div>
          <div className="flex items-center justify-between">
            <span>Accounts/Platform Cap:</span>
            <strong className="text-[#333333]">
              {planQuota.effectivePlan.accountsPerPlatformCap === "unlimited"
                ? "Unlimited"
                : `Up to ${planQuota.effectivePlan.accountsPerPlatformCap}`}
            </strong>
          </div>
          <div className="flex items-center justify-between">
            <span>24h Dispatches:</span>
            <strong className="text-[#333333]">
              {planQuota.effectivePlan.dailyRunsLimit === "unlimited"
                ? `${planQuota.runsLast24h} / Unlimited`
                : `${planQuota.runsLast24h} / ${planQuota.effectivePlan.dailyRunsLimit}`}
            </strong>
          </div>
        </div>
        <Link
          href="/settings#plans"
          className="text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
        >
          {activeLicense ? "Manage Plan & Ecosystem Pass" : "Upgrade Plan ($3 Pro / $5 VIP / $8 Max / $10 Extra)"}
        </Link>
        {planQuota.warningMessage && (
          <div role="status" className="w-full text-[11px] font-bold text-[#333333]">
            {planQuota.warningMessage}
          </div>
        )}
      </div>

      {banner && (
        <div
          className="md:col-span-3 text-xs flex items-center justify-between gap-4 bg-white text-[#333333]"
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-[11px] px-2 py-1 whitespace-nowrap border border-[#cccccc] rounded bg-white hover:font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Row 2: Important OneClickConnectPanel (2 cols) + Go-Live Readiness Checklist (1 col) */}
      <div className="md:col-span-2 bg-white">
        <OneClickConnectPanel
          compact
          apiFlags={apiCredentials}
          cloudMode={cloudMode}
          onConnected={() => {
            notifyCredentialsChanged();
            void refreshCredentialsStatus();
          }}
          onSelectProvider={(providerId) => {
            setConnectTab("api");
            setConnectPlatformId(null);
            setConnectProviderId(providerId);
            setConnectModalOpen(true);
          }}
          onOpenBrowserLogin={(platformId) => {
            setConnectTab("browser");
            setConnectPlatformId(platformId);
            setConnectProviderId(null);
            setConnectModalOpen(true);
          }}
        />
      </div>

      {/* Column 4: Interactive Real-Account Go-Live Readiness Checklist (1 col) */}
      {(() => {
        const hasAnyAccount =
          vaultAliases.length > 0 ||
          Object.entries(apiCredentials).some(([k, ok]) => k !== "openrouter" && Boolean(ok));
        const hasRealMedia = Boolean(probeInfo?.exists) || Boolean(mediaPath.trim());
        const complianceOk = !requires2257 || confirmed2257Attestation;
        const liveArmed = strictLive || simulationDisabled;
        return (
          <div className="md:col-span-1 bg-white space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-mono text-[10px] font-bold uppercase text-[#333333]">
                {liveArmed ? "LIVE MODE ARMED" : "DRY-RUN PREVIEW"}
              </span>
              <button
                type="button"
                onClick={() => setShowLiveGuide((v) => !v)}
                className="border px-2 py-0.5 rounded bg-white text-[#333333] text-[11px] font-medium cursor-pointer border-[#cccccc] hover:font-bold"
              >
                {showLiveGuide ? "Hide Guide" : "How to Post Live?"}
              </button>
            </div>

            <div className="ui-row-list">
              <button
                type="button"
                onClick={() => openConnectForPlatform()}
                className="w-full border flex items-center justify-between cursor-pointer text-left border-[#cccccc] bg-white hover:font-bold text-[#333333]"
              >
                <span>1. Accounts Connected</span>
                <span className="font-mono text-[10px] font-bold">
                  {hasAnyAccount ? `${vaultAliases.length} Vault + API` : "ADD ACCOUNT +"}
                </span>
              </button>
              <div className="flex items-center justify-between bg-white text-[#333333]">
                <span>2. Media Staged</span>
                <span className="font-mono text-[10px] font-bold">
                  {probeInfo?.exists ? "VERIFIED" : hasRealMedia ? "PATH SET" : "STAGE BELOW"}
                </span>
              </div>
              {requires2257 ? (
                <div className="flex items-center justify-between bg-white text-[#333333]">
                  <span>3. 2257 Compliance</span>
                  <span className="font-mono text-[10px] font-bold">
                    {complianceOk ? "CONFIRMED" : "CHECK BOX"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-white text-[#333333]">
                  <span>3. Multi-Account Pacing</span>
                  <span className="font-mono text-[10px] font-bold">
                    {staggerSec > 0 ? `${staggerSec}s STAGGER` : "AUTO JITTER"}
                  </span>
                </div>
              )}
              <button
                type="button"
                disabled={simulationDisabled}
                onClick={() => setStrictLive((v) => !v)}
                className={`w-full border flex items-center justify-between cursor-pointer text-left border-[#cccccc] bg-white hover:font-bold ${ liveArmed ? "text-[#333333]" : "text-[#666666]" }`}
              >
                <span>4. Strict Live Gate</span>
                <span className="font-mono text-[10px] font-bold">
                  {liveArmed ? "ENABLED" : "CLICK TO ARM"}
                </span>
              </button>
            </div>

            {showLiveGuide && (
              <div className="ui-cell text-[#666666] space-y-1 text-[11px]">
                <p className="font-semibold text-[#333333]">4 Steps to Publish Live:</p>
                <p>1. Connect accounts in <a href="/vault" className="text-[#333333] font-medium no-underline hover:font-bold">/vault</a>.</p>
                <p>2. Stage your real video/image below.</p>
                <p>3. Match your Vault alias &amp; check 2257 if adult.</p>
                <p>4. Enable Strict Live Only and click Launch.</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Centered Modal Overlay for Real-Time SSE Campaign Monitor */}
      {activeCampaign && (
        <div data-modal-overlay="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white">
          <div className="bg-white border border-[#cccccc] max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4">
              <div className="flex items-center space-x-3">
                <span className="relative flex h-3.5 w-3.5">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${ currentStep === "failed" ? "bg-white" : currentStep === "completed" ? "bg-white" : "animate-ping bg-white" }`}
                  ></span>
                  <span
                    className={`relative inline-flex rounded-full h-3.5 w-3.5 ${ currentStep === "failed" ? "bg-white" : currentStep === "completed" ? "bg-white" : "bg-white" }`}
                  ></span>
                </span>
                <div>
                  <h2 className="text-lg font-bold text-[#333333]">
                    Funnel Pipeline: {activeCampaign.campaignId}
                  </h2>
                  <p className="text-xs text-[#333333] font-mono">
                    {activeCampaign.strictLive ? "STRICT LIVE MODE" : "HYBRID / DRY-RUN MODE"} | SSE Live Stream ({activeCampaign.queuedInRedis ? "Redis BullMQ" : "In-Process"})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveCampaign(null)}
                className="border text-xs px-3 py-1.5 rounded-lg bg-white text-[#666666] font-medium cursor-pointer border-[#cccccc] hover:font-bold"
              >
                Close
              </button>
            </div>

            {/* Stepper Progress */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div
                className={`p-2.5 rounded-lg transition-all ${ currentStep === "uploading_master" ? "bg-white text-[#333333] font-bold" : uploadPercent === 100 ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
              >
                1. Stream Master ({uploadPercent}%)
              </div>
              <div
                className={`p-2.5 rounded-lg transition-all ${ currentStep === "injecting_url" ? "bg-white text-[#333333] font-bold" : currentStep === "broadcasting_teasers" || currentStep === "completed" ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
              >
                2. Inject Live URL
              </div>
              <div
                className={`p-2.5 rounded-lg transition-all ${ currentStep === "broadcasting_teasers" ? "bg-white text-[#333333] font-bold" : currentStep === "completed" ? "bg-white text-[#333333] font-bold" : currentStep === "failed" ? "bg-white text-[#333333] font-bold" : "bg-white text-[#999999]" }`}
              >
                3. Social Teasers ({publishedCount}/{teaserStates.length})
              </div>
            </div>

            {liveSnapshot?.masterError && (
              <div className="p-3 rounded-lg bg-white text-xs text-[#333333] font-mono">
                Pipeline Failed (Routed to DLQ): {liveSnapshot.masterError}
              </div>
            )}

            {/* Master Job Card */}
            <div className="p-4 rounded-xl bg-white space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-mono font-bold text-[#333333] uppercase tracking-wider">
                  Primary Master Destination
                </span>
                <span className="font-mono text-[#999999]">
                  {liveSnapshot?.masterSimulated ? "SIMULATED" : uploadPercent === 100 ? "LIVE DISPATCH" : "Zero-RAM Stream"}
                </span>
              </div>

              <div className="w-full bg-white text-xs font-mono text-[#999999]">
                Stream progress: {uploadPercent}%
              </div>

              <div className="flex justify-between items-center text-xs pt-1">
                <span className="text-[#333333] font-semibold">
                  {activeCampaign.masterJob.platformName} ({activeCampaign.masterJob.fileSizeMb} MB)
                </span>
                <span className="text-[#333333] font-mono text-[11px]">
                  {liveSnapshot?.liveMasterUrl ? "URL Captured" : `${uploadPercent}%`}
                </span>
              </div>

              {liveSnapshot?.liveMasterUrl && (
                <div className="p-2.5 rounded bg-white text-xs font-mono text-[#333333] break-all flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-[#333333]">Master URL: </span>
                    <a
                      href={liveSnapshot.liveMasterUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="no-underline font-medium hover:font-bold hover:text-[#333333]"
                    >
                      {liveSnapshot.liveMasterUrl}
                    </a>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(liveSnapshot.liveMasterUrl || "");
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className="border px-2 py-1 rounded bg-white text-[#333333] text-[10px] whitespace-nowrap cursor-pointer border-[#cccccc] hover:font-bold"
                  >
                    {copiedUrl ? "Copied!" : "Copy URL"}
                  </button>
                </div>
              )}
            </div>

            {/* Child Teasers */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-[#666666]">
                <span>Chained Social Teasers:</span>
                <div className="flex items-center space-x-2">
                  {publishedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const urls = [
                          liveSnapshot?.liveMasterUrl,
                          ...teaserStates.map((t: any) => t.publishedUrl),
                        ]
                          .filter(Boolean)
                          .join("\n");
                        if (urls) {
                          void navigator.clipboard.writeText(urls);
                          setCopiedAllUrls(true);
                          setTimeout(() => setCopiedAllUrls(false), 2000);
                        }
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-white border text-[#333333] font-semibold transition-colors cursor-pointer border-[#cccccc] hover:font-bold"
                    >
                      {copiedAllUrls ? "Copied All URLs!" : "Copy All Published URLs"}
                    </button>
                  )}
                  <span className="text-[#333333] font-mono text-[11px]">
                    {publishedCount} of {teaserStates.length} Published
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {teaserStates.map((t: any) => {
                  const status = t.status || "queued";
                  return (
                    <div
                      key={t.jobId}
                      className={`p-3 rounded-lg text-xs flex items-center justify-between gap-3 ${ status === "published" ? "bg-white text-[#333333]" : status === "failed" ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                    >
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-[#333333]">{t.platformName || t.platformId}</span>
                          {t.simulated !== undefined && (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${ t.simulated ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
                            >
                              {t.simulated ? "SIM" : "LIVE"}
                            </span>
                          )}
                        </div>
                        <p className="text-[#999999] text-[11px] font-mono truncate">
                          {t.error
                            ? `Error: ${String(t.error).split("\n")[0].slice(0, 110)}`
                            : t.publishedUrl || t.injectedCaption}
                        </p>
                        {t.error && String(t.error).length > 110 && (
                          <details className="text-[10px] text-[#666666] font-mono mt-0.5">
                            <summary className="cursor-pointer hover:text-[#333333]">Show full error details</summary>
                            <pre className="whitespace-pre-wrap break-all mt-1 p-1.5 rounded bg-white">
                              {t.error}
                            </pre>
                          </details>
                        )}
                        {t.failureScreenshot && (
                          <a
                            href={`/api/campaigns/failures/${encodeURIComponent(t.failureScreenshot)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block text-[10px] text-[#333333] no-underline hover:font-bold font-mono mt-0.5"
                          >
                            View Failure Screenshot
                          </a>
                        )}
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium uppercase whitespace-nowrap ${ status === "published" ? "bg-white text-[#333333]" : status === "failed" ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                      >
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              {teaserStates.some((t: any) => t.status === "failed") && (
                <button
                  type="button"
                  onClick={() => {
                    const failedList = teaserStates.filter((t: any) => t.status === "failed");
                    const perPlat: Record<string, string[]> = {};
                    for (const ft of failedList as any[]) {
                      const alias =
                        ft.accountId ||
                        (typeof ft.platformName === "string" && ft.platformName.includes("(@")
                          ? ft.platformName.split("(@")[1]?.replace(/\).*$/, "").trim()
                          : "") ||
                        accountId ||
                        "default";
                      if (!perPlat[ft.platformId]) perPlat[ft.platformId] = [];
                      if (!perPlat[ft.platformId].includes(alias)) perPlat[ft.platformId].push(alias);
                    }
                    const nextOverrides: Record<string, string> = {};
                    for (const [pid, list] of Object.entries(perPlat)) {
                      nextOverrides[pid] = list.join(", ");
                    }
                    setSelectedIds(Array.from(new Set([masterTargetId, ...Object.keys(perPlat)])));
                    setAccountOverrides(nextOverrides);
                    setShowAccountOverrides(true);
                    setActiveCampaign(null);
                    setBanner({
                      kind: "info",
                      text: `Configured Composer to retry ONLY the ${failedList.length} failed target(s). Click Launch below when ready.`,
                    });
                  }}
                  className="border flex-1 py-2.5 rounded-xl bg-white text-[#333333] font-bold text-xs cursor-pointer border-[#cccccc] hover:font-bold"
                >
                  Load Only Failed Targets ({teaserStates.filter((t: any) => t.status === "failed").length}) for Retry
                </button>
              )}
              <button
                onClick={() => setActiveCampaign(null)}
                className="border flex-1 py-2.5 rounded-xl bg-white text-[#333333] font-bold text-xs cursor-pointer border-[#cccccc] hover:font-bold"
              >
                Done / Close Monitor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Row 3: Column 2 Active Platform Registry & Constraint Calculator (1 col) */}
      <div className="md:col-span-1 ui-stack">
        <div className="bg-white space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#333333]">Active Registry</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const readyIds = ACTIVE_PLATFORMS.filter(
                      (pl) => getPlatformConnectionState(pl).connected,
                    ).map((pl) => pl.id);
                    if (readyIds.length === 0) {
                      setBanner({
                        kind: "info",
                        text: "No live connected platforms detected yet. Click '+ Add / Connect Accounts' above to connect accounts first.",
                      });
                      return;
                    }
                    setSelectedIds(Array.from(new Set([masterTargetId, ...readyIds])));
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-white border text-[#333333] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                >
                  Select Connected
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([masterTargetId])}
                  className="border text-[10px] px-2 py-0.5 rounded bg-white text-[#666666] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                >
                  Clear
                </button>
                <label className="flex items-center gap-1 text-[10px] text-[#999999] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRegistryOnly}
                    onChange={(e) => setShowRegistryOnly(e.target.checked)}
                    className="text-[#333333] focus:ring-0"
                  />
                  <span>All ({ACTIVE_PLATFORMS.length})</span>
                </label>
                <span className="text-xs px-2 py-0.5 rounded bg-white text-[#333333] font-mono">
                  {selectedIds.length} Selected
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              {["all", "sfw_social", "sfw_video", "nsfw_social", "nsfw_tube"].map((q) => (
                <button
                  key={q}
                  onClick={() => setActiveQuadrant(q)}
                  className={`px-2 py-1 bg-white cursor-pointer transition-colors border border-[#cccccc] rounded hover:font-bold ${ activeQuadrant === q ? "text-[#333333] font-bold" : "text-[#666666] hover:font-bold hover:text-[#333333]" }`}
                >
                  {q.replace("_", " ").toUpperCase()}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <LetterFilterBar
                searchQuery={platformSearch}
                onSearchChange={setPlatformSearch}
                selectedLetter={platformLetter}
                onLetterChange={setPlatformLetter}
                availableLetters={availablePlatformLetters}
                searchPlaceholder="Search 130+ platforms: fluxer, discord, stoat, matrix, nostr, bluesky, mastodon, pinterest..."
              />
              <div className="flex flex-wrap gap-1 text-[10px]">
                {[
                  { id: "nostr", label: "Nostr" },
                  { id: "bluesky", label: "Bluesky" },
                  { id: "mastodon", label: "Mastodon" },
                  { id: "misskey", label: "Misskey" },
                  { id: "lemmy", label: "Lemmy" },
                  { id: "tumblr", label: "Tumblr" },
                  { id: "matrix", label: "Matrix" },
                  { id: "farcaster", label: "Farcaster" },
                  { id: "telegram", label: "Telegram" },
                  { id: "wordpress", label: "WordPress" },
                  { id: "devto", label: "Dev.to" },
                  { id: "rumble", label: "Rumble" },
                  { id: "bitchute", label: "BitChute" },
                  { id: "odysee", label: "Odysee" },
                  { id: "redgifs", label: "RedGIFs" },
                  { id: "manyvids_store", label: "ManyVids" },
                  { id: "onlyfans_feed", label: "OnlyFans" },
                  { id: "fansly_wall", label: "Fansly" },
                  { id: "clips4sale", label: "Clips4Sale" },
                  { id: "mym_fans", label: "MYM" },
                  { id: "justforfans", label: "JFF" },
                  { id: "loyalfans_store", label: "LoyalFans" },
                  { id: "maloum", label: "Maloum" },
                  { id: "boosty", label: "Boosty" },
                  { id: "fancentro", label: "FanCentro" },
                  { id: "slushy", label: "Slushy" },
                  { id: "apclips", label: "APClips" },
                ].map((quick) => {
                  const checked = selectedIds.includes(quick.id);
                  return (
                    <button
                      type="button"
                      key={quick.id}
                      onClick={() => {
                        setPlatformSearch("");
                        if (activeQuadrant !== "all") {
                          const pDef = getPlatform(quick.id);
                          if (pDef.quadrant !== activeQuadrant) setActiveQuadrant("all");
                        }
                        togglePlatform(quick.id);
                      }}
                      className={`px-1.5 py-0.5 bg-white font-mono cursor-pointer transition-colors border border-[#cccccc] rounded hover:font-bold ${ checked ? "text-[#333333] font-bold" : "text-[#666666] hover:font-bold hover:text-[#333333]" }`}
                    >
                      {checked ? `✓ ${quick.label}` : `+ ${quick.label}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto ui-row-list pr-1">
              {filteredPlatforms.map((pl) => {
                const isSelected = selectedIds.includes(pl.id);
                const conn = getPlatformConnectionState(pl);
                return (
                  <div
                    key={pl.id}
                    className={`flex items-center justify-between !p-2 text-xs transition-colors ${ isSelected ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                  >
                    <label className="flex items-center space-x-2 truncate cursor-pointer flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => togglePlatform(pl.id)}
                        className="text-[#333333] focus:ring-0"
                      />
                      <span className="font-medium truncate">{pl.name}</span>
                      {pl.support === "registry_only" && !VAULT_BROWSER_PLATFORMS.some((vp) => vp.id === pl.id) && (
                        <span
                          title="Registry blueprint — configure connector or Vault browser session to publish"
                          className="shrink-0 rounded bg-white px-1 py-0.5 font-mono text-[9px] text-[#999999]"
                        >
                          REG
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openConnectForPlatform(pl)}
                        className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold cursor-pointer border border-[#cccccc] bg-white hover:font-bold ${ conn.connected ? "bg-white text-[#333333] border border-[#cccccc]" : "bg-white text-[#333333] border border-[#cccccc] hover:bg-white" }`}
                      >
                        {conn.label}
                      </button>
                      <span className="font-mono text-[10px] text-[#999999] w-10 text-right">
                        {pl.maxMb >= 1024 ? `${(pl.maxMb / 1024).toFixed(0)} GB` : `${pl.maxMb} MB`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reactive File-Size Engine Card */}
          <div className="bg-white space-y-3">
            <h2 className="text-sm font-bold text-[#333333]">Reactive File-Size Engine</h2>

            <div className="flex items-center space-x-2 text-xs">
              <button
                onClick={() => setScalingMode("strict")}
                className={`flex-1 py-1.5 rounded font-medium transition-colors border border-[#cccccc] bg-white hover:font-bold ${ scalingMode === "strict" ? "border border-[#cccccc] bg-white text-[#333333]" : "border border-[#cccccc] bg-white text-[#999999]" }`}
              >
                Strict Ceiling
              </button>
              <button
                onClick={() => setScalingMode("waterfall_autoscale")}
                className={`flex-1 py-1.5 rounded font-medium transition-colors border border-[#cccccc] bg-white hover:font-bold ${ scalingMode === "waterfall_autoscale" ? "border border-[#cccccc] bg-white text-[#333333]" : "border border-[#cccccc] bg-white text-[#999999]" }`}
              >
                Waterfall Autoscale
              </button>
            </div>

            <div className="bg-white rounded-lg p-3 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[#999999]">Current Upload Ceiling:</span>
                <span className="font-mono font-bold text-[#333333]">
                  {constraints.allowedMaxMb >= 1024
                    ? `${(constraints.allowedMaxMb / 1024).toFixed(1)} GB`
                    : `${constraints.allowedMaxMb} MB`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#999999]">Bottleneck Platform:</span>
                <span className="font-mono text-[#333333]">
                  {constraints.bottleneckPlatform?.name || "None"}
                </span>
              </div>
              {scalingMode === "strict" && constraints.bottleneckPlatform && (
                <div className="flex justify-between items-center text-[11px] text-[#333333] pt-1">
                  <span>If {constraints.bottleneckPlatform.name} unchecked:</span>
                  <span className="font-mono font-semibold">
                    {constraints.nextLimitIfUnchecked >= 1024
                      ? `${(constraints.nextLimitIfUnchecked / 1024).toFixed(1)} GB`
                      : `${constraints.nextLimitIfUnchecked} MB`}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[#999999]">Master Video Size (MB):</label>
              <input
                type="number"
                value={masterMb}
                onChange={(e) => setMasterMb(Number(e.target.value) || 1)}
                className="w-full bg-white px-3 py-1.5 text-xs text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs text-[#999999] font-medium">Waterfall Renditions:</span>
              <div className="max-h-48 overflow-y-auto ui-row-list pr-1">
                {waterfallPlan.map((item) => (
                  <div
                    key={item.platformId}
                    className="!p-1.5 bg-white text-[11px] flex justify-between items-center"
                  >
                    <span className="text-[#666666] font-medium">{item.platformId}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${ item.rendition === "master" ? "bg-white text-[#333333]" : item.rendition === "promo_cut" ? "bg-white text-[#333333]" : item.rendition === "teaser_clip" ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                    >
                      {item.rendition}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Columns 3 & 4: Important Media Ingestion, AI Captions & Funnel Chaining (2 cols) */}
        <div className="md:col-span-2 ui-stack">
          {/* Media Ingestion & Account Alias */}
          <div className="bg-white space-y-3">
            <h2 className="text-sm font-bold text-[#333333]">Media Ingestion, File Probe &amp; Target Vault Alias</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-[#999999] block">
                  Compress &amp; Watermark Image (Browser WASM WebP &lt; 1MB + Cloud Attach):
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleClientCompression}
                  className="w-full text-xs text-[#999999] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-[#cccccc] file:text-xs file:font-medium file:bg-white file:text-[#333333] hover:file:bg-white cursor-pointer border-0 border-b border-[#cccccc] rounded-none bg-white"
                />
                {compressedImageInfo && (
                  <div className="p-2 rounded bg-white text-xs text-[#333333]">
                    {compressedImageInfo}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-[#999999]">
                      Target Account Alias(es) — comma-separated for 5–10+ accounts:
                    </label>
                    <button
                      type="button"
                      onClick={() => openConnectForPlatform(getPlatform(masterTargetId))}
                      className="text-[11px] text-[#333333] no-underline hover:font-bold cursor-pointer border border-[#cccccc] rounded bg-white"
                    >
                      + Connect / Add Account
                    </button>
                  </div>
                  {showAccountOverrides &&
                  selectedIds.length > 0 &&
                  selectedIds.every((pid) => Boolean(accountOverrides[pid]?.trim())) ? (
                    <div className="px-3 py-1.5 rounded bg-white text-[11px] text-[#333333] font-mono">
                      All {selectedIds.length} selected platforms use explicit per-platform account overrides below.
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        list="vault-aliases"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        placeholder="e.g. main_creator  OR  x_acc_1, x_acc_2, x_acc_3, x_acc_4, x_acc_5"
                        className="w-full bg-white px-3 py-1.5 text-xs text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
                      />
                      <datalist id="vault-aliases">
                        {vaultAliases.map((a) => (
                          <option key={a} value={a} />
                        ))}
                      </datalist>
                    </>
                  )}
                  {vaultAliases.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5 text-[10px]">
                      <span className="text-[#999999]">Click to toggle multi-account fan-out:</span>
                      {vaultAliases.map((a) => {
                        const currentList = accountId
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        const isIncluded = currentList.includes(a);
                        return (
                          <button
                            type="button"
                            key={a}
                            onClick={() => {
                              if (isIncluded && currentList.length > 1) {
                                setAccountId(currentList.filter((item) => item !== a).join(", "));
                              } else if (!isIncluded) {
                                setAccountId([...currentList, a].join(", "));
                              } else {
                                setAccountId(a);
                              }
                            }}
                            className={`px-1.5 py-0.5 rounded border font-mono cursor-pointer border-[#cccccc] bg-white hover:font-bold ${ isIncluded ? "bg-white border-[#cccccc] text-[#333333] font-semibold" : "bg-white border-[#cccccc] text-[#999999] hover:text-[#333333]" }`}
                          >
                            {isIncluded ? `✓ ${a}` : `+ ${a}`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedIds.length > 0 && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => setShowAccountOverrides((v) => !v)}
                        className="text-[11px] text-[#333333] hover:text-[#333333] cursor-pointer border border-[#cccccc] rounded bg-white hover:font-bold"
                      >
                        {showAccountOverrides
                          ? "Hide per-platform multi-account overrides"
                          : "Assign specific or multiple (5–10) accounts per platform? (Click to configure)"}
                      </button>
                      {showAccountOverrides && (
                        <div className="mt-2 p-2.5 rounded bg-white space-y-1.5 max-h-44 overflow-y-auto">
                          <p className="text-[10px] text-[#999999]">
                            Tip: Enter comma-separated aliases (e.g. <code className="text-[#333333]">x_1, x_2, x_3, x_4, x_5</code>), Reddit subreddit targets (<code className="text-[#333333]">reddit_1:r/cyberpunk</code>), or per-account promo link overrides (<code className="text-[#333333]">x_1|https://onlyfans.com/persona1</code>) to fan out in one campaign!
                          </p>
                          {selectedIds.map((pid) => (
                            <div key={pid} className="flex items-center justify-between gap-1.5 text-[11px]">
                              <span className="font-mono text-[#666666] w-28 truncate">{pid}</span>
                              <input
                                type="text"
                                list="vault-aliases"
                                value={accountOverrides[pid] ?? ""}
                                placeholder={accountId || "default (or acc_1, acc_2...)"}
                                onChange={(e) =>
                                  setAccountOverrides((prev) => ({ ...prev, [pid]: e.target.value }))
                                }
                                className="flex-1 bg-white px-2 py-0.5 text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
                              />
                              <div className="flex items-center gap-1 shrink-0">
                                {pid === "reddit" && (
                                  <button
                                    type="button"
                                    title="Append :r/subreddit target to this override"
                                    onClick={() =>
                                      setAccountOverrides((prev) => {
                                        const cur = (prev[pid] || accountId || "reddit_1").trim();
                                        return { ...prev, [pid]: cur.includes(":r/") ? cur : `${cur}:r/cyberpunk` };
                                      })
                                    }
                                    className="px-1.5 py-0.5 rounded bg-white border text-[9px] text-[#333333] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                                  >
                                    +:r/sub
                                  </button>
                                )}
                                <button
                                  type="button"
                                  title="Append #WatermarkText override for this account"
                                  onClick={() =>
                                    setAccountOverrides((prev) => {
                                      const cur = (prev[pid] || accountId || `${pid}_1`).trim();
                                      return { ...prev, [pid]: cur.includes("#") ? cur : `${cur}#@StudioNova` };
                                    })
                                  }
                                  className="px-1.5 py-0.5 rounded bg-white border text-[9px] text-[#333333] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                                >
                                  +#WM
                                </button>
                                <button
                                  type="button"
                                  title="Append |https://... per-account promo URL override"
                                  onClick={() =>
                                    setAccountOverrides((prev) => {
                                      const cur = (prev[pid] || accountId || `${pid}_1`).trim();
                                      return {
                                        ...prev,
                                        [pid]: cur.includes("|") ? cur : `${cur}|https://onlyfans.com/creator`,
                                      };
                                    })
                                  }
                                  className="px-1.5 py-0.5 rounded bg-white border text-[9px] text-[#333333] font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                                >
                                  +|URL
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1.5 text-[11px]">
                        <span className="text-[#999999]">
                          Multi-Account Stagger Delay (+0.25s/account video hash shift):
                        </span>
                        <select
                          value={staggerSec}
                          onChange={(e) => setStaggerSec(Number(e.target.value) || 0)}
                          className="bg-white px-2 py-0.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
                        >
                          <option value={0}>Auto (~1s jitter)</option>
                          <option value={5}>5s between accounts</option>
                          <option value={15}>15s between accounts</option>
                          <option value={30}>30s between accounts</option>
                          <option value={60}>60s between accounts</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-[#999999] block mb-1">
                    Upload / Stage Local Video or Image to Disk (Streaming Zero-RAM):
                  </label>
                  <div className="mb-2">
                    <input
                      type="file"
                      accept="video/*,image/*"
                      onChange={handleStageMediaFile}
                      disabled={uploadingMedia}
                      className="w-full text-xs text-[#999999] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-[#cccccc] file:text-xs file:font-medium file:bg-white file:text-[#333333] hover:file:bg-white cursor-pointer disabled:opacity-50 border-0 border-b border-[#cccccc] rounded-none bg-white"
                    />
                    {uploadingMedia && (
                      <p className="text-[11px] text-[#333333] font-mono mt-1">Streaming file directly to disk...</p>
                    )}
                    {stagedUploadInfo && (
                      <p className="text-[11px] text-[#333333] font-mono mt-1">{stagedUploadInfo}</p>
                    )}
                  </div>
                  <label className="text-xs text-[#999999] block mb-1">
                    Video Master Path (Zero-RAM Disk Stream):
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Upload above or paste local video/image path"
                      className="flex-1 bg-white px-3 py-1.5 text-xs text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
                    />
                    <button
                      onClick={() => void handleProbeMedia()}
                      disabled={probingMedia}
                      className="border px-3 py-1.5 rounded bg-white text-xs text-[#333333] font-medium whitespace-nowrap cursor-pointer border-[#cccccc] hover:font-bold"
                    >
                      {probingMedia ? "Probing..." : "Inspect File"}
                    </button>
                  </div>
                  {probeInfo && (
                    <div
                      className={`mt-2 p-3 rounded text-[11px] font-mono space-y-2 ${ probeInfo.exists ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
                    >
                      <div>
                        {probeInfo.exists
                          ? `Ready on disk: ${probeInfo.width}x${probeInfo.height}, ${probeInfo.durationSec?.toFixed(1)}s, ${probeInfo.sizeMb} MB, encoder: ${probeInfo.recommendedEncoder}`
                          : `Disk check: ${probeInfo.error} (Live browser upload requires an existing local file)`}
                      </div>
                      {probeInfo.safetyScan && (
                        <div className="text-[10px] text-[#666666]">
                          {probeInfo.safetyScan.available
                            ? `NudeNet Scan: max score ${probeInfo.safetyScan.sensitivityScore} across ${probeInfo.safetyScan.framesScanned} keyframes`
                            : `Safety Scan: ${probeInfo.safetyScan.reason || probeInfo.safetyScan.error}`}
                        </div>
                      )}
                      {probeInfo.previewDataUrl && (
                        <div className="flex items-start gap-3 pt-1">
                          <img
                            src={probeInfo.previewDataUrl}
                            alt="Teaser keyframe preview"
                            className="w-36 rounded bg-white"
                          />
                          <div className="text-[10px] text-[#666666] space-y-1">
                            <div>Frame Preview @ {(probeInfo.previewStartSec ?? startSec).toFixed(1)}s</div>
                            {typeof probeInfo.recommendedStartSec === "number" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setStartSec(probeInfo.recommendedStartSec!);
                                  void handleProbeMedia(probeInfo.recommendedStartSec!, false);
                                }}
                                className="border px-2 py-1 rounded bg-white text-[#333333] cursor-pointer border-[#cccccc] hover:font-bold"
                              >
                                Jump to Suggested ({probeInfo.recommendedStartSec.toFixed(1)}s)
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Teaser Keyframe Scrubber & Watermark Burn Controls */}
                <div className="grid grid-cols-1 gap-[5px] pt-1 text-xs">
                  <div className="min-w-0">
                    <label className="text-[#999999] block mb-1">
                      Teaser Offset ({startSec.toFixed(1)}s):
                    </label>
                    <div className="flex items-center gap-[5px] min-w-0">
                      <input
                        type="range"
                        min={0}
                        max={Math.max(1, Math.floor(probeInfo?.durationSec || 60))}
                        step={0.5}
                        value={startSec}
                        onChange={(e) => setStartSec(Number(e.target.value) || 0)}
                        className="min-w-0 flex-1 accent-[#333333] border-0 border-b border-[#cccccc] rounded-none bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleProbeMedia(startSec, false)}
                        disabled={probingMedia}
                        className="shrink-0 border px-2 py-1 rounded bg-white text-[10px] text-[#333333] cursor-pointer border-[#cccccc] hover:font-bold"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-[5px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <label className="text-[#999999]">Watermark Burn Text:</label>
                        <button
                          type="button"
                          onClick={() =>
                            setWatermarkText((prev) =>
                              prev.includes("{{ACCOUNT_ID}}")
                                ? prev
                                : prev.trim()
                                  ? `${prev.trim()} @{{ACCOUNT_ID}}`
                                  : "@{{ACCOUNT_ID}}",
                            )
                          }
                          className="text-[10px] px-1.5 py-0.5 text-[#333333] hover:text-[#333333] font-mono cursor-pointer border border-[#cccccc] rounded bg-white hover:font-bold"
                          title="Burn each account's own alias into its video teaser"
                        >
                          + @&#123;&#123;ACCOUNT_ID&#125;&#125;
                        </button>
                      </div>
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        placeholder="e.g. @StudioNova or @{{ACCOUNT_ID}}"
                        className="w-full bg-white px-2.5 py-1.5 text-xs text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="text-[#999999] block mb-1">Watermark Position:</label>
                      <select
                        value={watermarkPosition}
                        onChange={(e) => setWatermarkPosition(e.target.value as any)}
                        className="w-full bg-white px-2.5 py-1.5 text-xs text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                      >
                        <option value="bottom-right">Bottom Right</option>
                        <option value="bottom-left">Bottom Left</option>
                        <option value="top-right">Top Right</option>
                        <option value="top-left">Top Left</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Caption Spinner */}
          <div className="bg-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#333333]">AI Caption Spinner</h2>
                <p className="text-[11px] text-[#999999]">
                  Calls local Ollama (`dolphin3`), OpenRouter, or Venice with strict SFW denylist &amp; sibling similarity guards.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {spinSource && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#333333] font-mono">
                    {spinSource === "llm_provider" ? "LLM Spin" : "Offline Structured"}
                  </span>
                )}
                <button
                  onClick={handleSpinCaptions}
                  disabled={spinningCaptions}
                  className="border px-3 py-1.5 rounded bg-white text-[#333333] text-xs font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                >
                  {spinningCaptions ? "Spinning..." : "Spin Unique Captions"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="md:col-span-2">
                <label className="text-[#999999] block mb-1">Post Topic:</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Niche / Series:</label>
                <input
                  type="text"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Creator / Alias:</label>
                <input
                  type="text"
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#999999]">PPV Price ($):</label>
                  <button
                    type="button"
                    onClick={() => setShowPriceOverrides((v) => !v)}
                    className="text-[10px] text-[#333333] hover:text-[#333333] cursor-pointer border border-[#cccccc] rounded bg-white hover:font-bold"
                  >
                    {showPriceOverrides ? "Hide store overrides" : "Per-store price?"}
                  </button>
                </div>
                <input
                  type="number"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(Number(e.target.value) || 0)}
                  className="w-full bg-white px-3 py-1.5 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">SEO Seed Tags (synced with Preset):</label>
                <input
                  type="text"
                  value={seedTags}
                  onChange={(e) => setSeedTags(e.target.value)}
                  className="w-full bg-white px-3 py-1.5 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
            </div>

            {showPriceOverrides && selectedIds.length > 0 && (
              <div className="p-2.5 rounded bg-white space-y-1.5 text-[11px]">
                <p className="text-[10px] text-[#999999]">
                  Set custom unlock / clip prices per platform (use <code className="text-[#333333]">&#123;&#123;PRICE_USD&#125;&#125;</code> in any caption to auto-inject that store&apos;s price):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {selectedIds.map((pid) => (
                    <div key={pid} className="flex items-center justify-between gap-1.5">
                      <span className="font-mono text-[#666666] truncate">{pid}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={priceOverrides[pid] ?? ""}
                        placeholder={`$${priceUsd}`}
                        onChange={(e) =>
                          setPriceOverrides((prev) => ({ ...prev, [pid]: e.target.value }))
                        }
                        className="w-20 bg-white px-2 py-0.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#666666]">Generated Profile Variations:</span>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCaptionOverrides((v) => !v)}
                    className="text-[11px] text-[#333333] hover:text-[#333333] cursor-pointer border border-[#cccccc] rounded bg-white hover:font-bold"
                  >
                    {showCaptionOverrides
                      ? "Hide per-platform caption overrides"
                      : "Customize caption for a specific platform? (Click to override)"}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                {CAPTION_PROFILES.map((profile) => (
                  <div key={profile} className="ui-cell space-y-1">
                    <span className="text-[11px] font-mono uppercase text-[#333333] font-bold block">
                      {profile}
                    </span>
                    <textarea
                      rows={3}
                      value={generatedCaptions[profile]}
                      onChange={(e) =>
                        setGeneratedCaptions((prev) => ({ ...prev, [profile]: e.target.value }))
                      }
                      className="w-full bg-white p-2 text-xs text-[#333333] resize-none font-mono border-0 border-b border-[#cccccc] rounded-none"
                    />
                  </div>
                ))}
              </div>
              {showCaptionOverrides && selectedIds.length > 0 && (
                <div className="p-3 rounded-lg bg-white space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-[#999999]">
                      Optional Per-Platform Caption Override (leave blank to use the shared profile text above):
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const hooks = [
                            "New drop live now — ",
                            "Fresh studio cut: ",
                            "Uncut release out now: ",
                            "Behind the scenes + full set: ",
                            "Exclusive 4K premiere — ",
                            "Just unlocked: ",
                          ];
                          const next: Record<string, string> = {};
                          selectedIds.forEach((pid, idx) => {
                            const pl = getPlatform(pid);
                            const prof = profileForPlatform(pl);
                            const base = generatedCaptions[prof] || topic;
                            const prefix = hooks[idx % hooks.length];
                            next[pid] = base.startsWith(prefix) ? base : `${prefix}${base}`;
                          });
                          setCaptionOverrides(next);
                        }}
                        className="px-2 py-0.5 rounded bg-white border text-[10px] text-[#333333] font-semibold cursor-pointer border-[#cccccc] hover:font-bold"
                      >
                        Auto-Vary All ({selectedIds.length}) Platforms
                      </button>
                      {Object.keys(captionOverrides).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setCaptionOverrides({})}
                          className="border px-2 py-0.5 rounded bg-white text-[10px] text-[#666666] cursor-pointer border-[#cccccc] hover:font-bold"
                        >
                          Clear Overrides
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                    {selectedIds.map((pid) => {
                      const pl = getPlatform(pid);
                      const fallbackProf = profileForPlatform(pl);
                      return (
                        <div key={pid} className="space-y-1">
                          <span className="text-[11px] font-mono text-[#666666] block">
                            {pl.name} (<span className="text-[#333333]">{pid}</span>)
                          </span>
                          <textarea
                            rows={2}
                            value={captionOverrides[pid] ?? ""}
                            placeholder={generatedCaptions[fallbackProf] || topic}
                            onChange={(e) =>
                              setCaptionOverrides((prev) => ({ ...prev, [pid]: e.target.value }))
                            }
                            className="w-full bg-white p-1.5 text-[11px] text-[#333333] resize-none font-mono border-0 border-b border-[#cccccc] rounded-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Live Caption Preflight, Character Limits & Spintax Uniqueness Check */}
            <div className="bg-white pt-2 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[#666666]">
                  Caption Preflight:{" "}
                  <strong className="text-[#333333]">
                    {captionPreflight.allOk
                      ? `All ${captionPreflight.items.length} destination(s) within char limits & SFW policy`
                      : `${captionPreflight.overLimitCount} over char limit · ${captionPreflight.strictViolationCount} strict-SFW flag(s) · ${captionPreflight.duplicateSiblingRiskCount} sibling duplicate risk(s)`}
                  </strong>
                  {activeSpintaxSummary.hasSpintax && (
                    <span className="ml-2 font-mono text-[11px] text-[#999999]">
                      ({activeSpintaxSummary.permutations.toLocaleString()} spintax variants)
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleInjectSpintaxAllProfiles}
                    className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] cursor-pointer"
                  >
                    + Inject Anti-Spam Spintax
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyCaptionSheet()}
                    className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] cursor-pointer"
                  >
                    Copy Caption Sheet
                  </button>
                  {(captionPreflight.overLimitCount > 0 || captionPreflight.strictViolationCount > 0) && (
                    <button
                      type="button"
                      onClick={handleAutoFixCaptions}
                      className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] font-bold text-[#333333] hover:font-bold cursor-pointer"
                    >
                      Auto-Fit Overlong &amp; Clean Strict-SFW
                    </button>
                  )}
                  <span role="status" className="text-[11px] text-[#666666]">
                    {preflightCopyStatus}
                  </span>
                </div>
              </div>

              <details className="bg-white text-[11px] text-[#666666]">
                <summary className="cursor-pointer text-[#666666] hover:font-bold hover:text-[#333333]">
                  Inspect per-platform character limits &amp; live spintax samples ({captionPreflight.items.length})
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {captionPreflight.items.map((item) => (
                      <div key={item.platformId} className="bg-white py-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={item.ok ? "text-[#333333]" : "font-bold text-[#333333]"}>
                            {item.platformName}
                          </span>
                          <span
                            className={`font-mono text-[10px] ${
                              item.overLimit ? "font-bold text-[#333333]" : "text-[#999999]"
                            }`}
                          >
                            {item.resolvedLength} / {item.maxChars} chars
                          </span>
                        </div>
                        {item.strictViolation && (
                          <div className="text-[10px] font-bold text-[#333333]">
                            Strict-SFW term flagged: &ldquo;{item.strictViolation}&rdquo;
                          </div>
                        )}
                        {item.duplicateSiblingRisk && (
                          <div className="text-[10px] text-[#666666]">
                            {item.accountCount} sibling accounts but only {item.spintaxPermutations} spintax variant(s) — add {"{opt1|opt2|opt3}"}
                          </div>
                        )}
                        {item.unbalancedBraces && (
                          <div className="text-[10px] font-bold text-[#333333]">
                            Unbalanced spintax braces detected
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {activeSpintaxSummary.hasSpintax && (
                    <div className="pt-2 space-y-1">
                      <div className="font-bold text-[#333333]">
                        Spintax Sample Permutations ({activeSpintaxSummary.blockCount} block(s), {activeSpintaxSummary.permutations.toLocaleString()} total):
                      </div>
                      {activeSpintaxSummary.samples.map((sample, idx) => (
                        <div key={idx} className="font-mono text-[10px] text-[#666666] break-words">
                          #{idx + 1}: {sample}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>

          {/* Automated Funnel-Link Chaining & 2257 Gate */}
          <div className="bg-white space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#333333]">
                Automated Funnel-Link Chaining (BullMQ FlowProducer)
              </h2>
              <span className="text-xs px-2 py-0.5 rounded bg-white text-[#333333] font-mono">
                Master → Teasers
              </span>
            </div>

            <div className="p-4 bg-white rounded-lg space-y-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center space-x-3">
                  <span className="text-[#999999] whitespace-nowrap">1. Primary Master:</span>
                  <select
                    value={masterTargetId}
                    onChange={(e) => setMasterTargetId(e.target.value)}
                    className="flex-1 bg-white px-2.5 py-1.5 text-[#333333] font-medium border-0 border-b border-[#cccccc] rounded-none"
                  >
                    <optgroup label="Video & Alt-Tech Master Hosts">
                      <option value="youtube">YouTube Long (4K)</option>
                      <option value="rumble">Rumble Channel</option>
                      <option value="bitchute">BitChute Channel</option>
                      <option value="odysee">Odysee / LBRY</option>
                      <option value="bilibili">Bilibili</option>
                      <option value="vimeo">Vimeo</option>
                      <option value="peertube">PeerTube</option>
                    </optgroup>
                    <optgroup label="Creator Walls & Clip Stores">
                      <option value="onlyfans_feed">OnlyFans — Creator Feed</option>
                      <option value="onlyfans_ppv">OnlyFans — PPV / Vault</option>
                      <option value="fansly_vault">Fansly — Vault / PPV</option>
                      <option value="fansly_wall">Fansly — Timeline Wall</option>
                      <option value="manyvids_store">ManyVids — Video Store</option>
                      <option value="manyvids_club">ManyVids — MV Club</option>
                      <option value="clips4sale">Clips4Sale (C4S Studio)</option>
                      <option value="iwantclips">IWantClips (IWC Store)</option>
                      <option value="mym_fans">MYM.fans (MYM Creator)</option>
                      <option value="justforfans">JustFor.Fans (JFF)</option>
                       <option value="loyalfans_store">LoyalFans — Video Store</option>
                      <option value="loyalfans_timeline">LoyalFans — Timeline Wall</option>
                      <option value="fanvue">Fanvue</option>
                      <option value="admireme">AdmireMe.VIP</option>
                      <option value="maloum">Maloum</option>
                      <option value="boosty">Boosty</option>
                      <option value="fancentro">FanCentro</option>
                      <option value="slushy">Slushy</option>
                      <option value="apclips">APClips</option>
                      <option value="modelhub">Modelhub</option>
                      <option value="bentbox">BentBox</option>
                      <option value="kofi">Ko-fi</option>
                      <option value="subscribestar_adult">SubscribeStar.Adult</option>
                      <option value="patreon_18">Patreon (18+)</option>
                      <option value="fetlife">FetLife</option>
                    </optgroup>
                    <optgroup label="18+ Video Tube Networks">
                      <option value="pornhub_video">Pornhub — Long Video</option>
                      <option value="xvideos">XVideos / Sheer</option>
                      <option value="xhamster">xHamster</option>
                      <option value="spankbang">SpankBang</option>
                      <option value="eporner">EPorner (4K/60fps)</option>
                      <option value="redtube">RedTube</option>
                      <option value="youporn">YouPorn</option>
                      <option value="motherless">Motherless</option>
                      <option value="iwara">Iwara.tv</option>
                      <option value="redgifs">RedGIFs</option>
                    </optgroup>
                  </select>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[#999999] whitespace-nowrap">Or Existing URL:</span>
                  <input
                    type="url"
                    value={existingMasterUrl}
                    onChange={(e) => setExistingMasterUrl(e.target.value)}
                    placeholder="https://onlyfans.com/... or Link-in-Bio (skips master upload)"
                    className="flex-1 bg-white px-2.5 py-1.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="flex items-center space-x-2 text-[#666666] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={postFirstComment}
                      onChange={(e) => setPostFirstComment(e.target.checked)}
                      className="text-[#333333]"
                    />
                    <span>Post link in 1st Reply</span>
                  </label>

                  <label className="flex items-center space-x-2 text-[#666666] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={appendUtm}
                      onChange={(e) => setAppendUtm(e.target.checked)}
                      className="text-[#333333]"
                    />
                    <span>Append UTM Source/Account Tags</span>
                  </label>

                  <label className="flex items-center space-x-2 text-[#666666] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoReconcile}
                      onChange={(e) => setAutoReconcile(e.target.checked)}
                      className="text-[#333333]"
                    />
                    <span>Auto-Reconcile Teasers (&lt;9.5MB + EXIF Strip)</span>
                  </label>

                  <label className="flex items-center space-x-2 text-[#666666] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={strictLive}
                      disabled={simulationDisabled}
                      onChange={(e) => setStrictLive(e.target.checked)}
                      className="text-[#333333]"
                    />
                    <span className={strictLive ? "text-[#333333] font-semibold" : "text-[#666666]"}>
                      {simulationDisabled ? "Strict Live Locked (.env)" : "Strict Live Only"}
                    </span>
                  </label>

                  <label className="flex items-center space-x-1.5 text-[#666666]">
                    <span className="text-[#999999]">Schedule:</span>
                    <select
                      value={delayMinutes}
                      onChange={(e) => setDelayMinutes(Number(e.target.value) || 0)}
                      className="bg-white px-2 py-0.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
                    >
                      <option value={0}>Immediate (0m)</option>
                      <option value={15}>+15 mins</option>
                      <option value={30}>+30 mins</option>
                      <option value={60}>+1 hour</option>
                      <option value={120}>+2 hours</option>
                      <option value={360}>+6 hours</option>
                      <option value={720}>+12 hours</option>
                      <option value={1440}>+24 hours</option>
                    </select>
                  </label>
                </div>

                {postFirstComment && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-[#999999] mb-1">
                      First-Comment Template{" "}
                      <span className="text-[#999999] font-normal">
                        (optional — supports{" "}
                        <code className="text-[#333333]">{"{{LIVE_MASTER_URL}}"}</code> &{" "}
                        <code className="text-[#333333]">{"{{PRICE_USD}}"}</code>; auto-varied across sibling accounts & skipped on clip stores)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={firstCommentTemplate}
                      onChange={(e) => setFirstCommentTemplate(e.target.value)}
                      placeholder="Watch the full video here: {{LIVE_MASTER_URL}} (leave blank for automatic sibling-varied CTA)"
                      className="w-full bg-white px-2.5 py-1.5 text-xs text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                    />
                  </div>
                )}

              {requires2257 && (
                <div className="p-3 rounded-lg bg-white space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#333333] font-bold uppercase tracking-wider text-[11px]">
                      18 U.S.C. 2257 Adult Record-Keeping Gate Required
                    </span>
                    <span className="font-mono text-[11px] text-[#333333]">ID: {recordsId2257}</span>
                  </div>
                  <label className="flex items-start space-x-2 text-[#333333] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed2257Attestation}
                      onChange={(e) => setConfirmed2257Attestation(e.target.checked)}
                      className="mt-0.5 text-[#333333]"
                    />
                    <span>
                      I attest that performer age/identity records under <code className="font-mono">{recordsId2257}</code> are verified and authorize 2257 compliance form submission.
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleLaunchCampaign}
                disabled={isLaunching}
                className="flex-1 py-3 rounded-lg bg-white text-[#333333] font-bold text-sm transition-all disabled:opacity-50 cursor-pointer border border-[#cccccc] hover:font-bold"
              >
                {isLaunching
                  ? "Submitting to FlowProducer..."
                  : fanOutSummary.isTeaserOnly
                  ? `Launch Teaser-Only Fast Campaign (${fanOutSummary.teaserJobs} Jobs across ${fanOutSummary.totalPlatforms} platforms & ${fanOutSummary.uniqueAccountsCount} account(s))`
                  : `${strictLive ? "Launch STRICT LIVE" : "Launch Multi-Engine"} Campaign (${fanOutSummary.masterJobs} Master + ${fanOutSummary.teaserJobs} Teaser Jobs · ${fanOutSummary.uniqueAccountsCount} account(s))`}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveToCalendarQueue()}
                disabled={queuingToCalendar}
                className="py-3 px-4 rounded-lg bg-white text-[#666666] hover:text-[#333333] text-xs cursor-pointer border border-[#cccccc] hover:font-bold whitespace-nowrap"
              >
                {queuingToCalendar
                  ? "Saving..."
                  : `Save to Calendar (+${delayMinutes > 0 ? `${delayMinutes}m` : "60m"} UTC)`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

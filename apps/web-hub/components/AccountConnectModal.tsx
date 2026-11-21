"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  clearClientCredentialKeys,
  getClientCredentials,
  getSavedCompanionUrl,
  maskClientPreview,
  saveClientCredentials,
  setSavedCompanionUrl,
} from "@/lib/client-vault";
import {
  COMPANION_CHANGED_EVENT,
  DEFAULT_LOCAL_COMPANION_URL,
  detectActiveCompanion,
  notifyCompanionChanged,
  notifyCredentialsChanged,
  probeCompanionUrl,
  vaultApiFetch,
} from "@/lib/companion-bridge";
import { buildClientApiFlags } from "@/lib/credential-mapping";
import {
  normalizePlatformFamily,
  PLATFORM_SAFETY_CAPS,
  SPA_BROWSER_ORIGIN_PLATFORMS,
} from "@/lib/account-safety";
import { LetterFilterBar, matchesSearchAndLetter } from "./LetterFilterBar";
import { OneClickConnectPanel } from "./OneClickConnectPanel";

interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  isSet: boolean;
  preview: string;
}

interface CredentialProvider {
  id: string;
  name: string;
  category: string;
  helpText: string;
  configured: boolean;
  fields: CredentialField[];
}

export const VAULT_BROWSER_PLATFORMS = [
  // Creator Subscription Walls & Clip Stores
  { id: "onlyfans_feed", name: "OnlyFans — Creator Feed", category: "Creator Walls & Clip Stores" },
  { id: "onlyfans_ppv", name: "OnlyFans — PPV / Vault", category: "Creator Walls & Clip Stores" },
  { id: "fansly_wall", name: "Fansly — Timeline Wall", category: "Creator Walls & Clip Stores" },
  { id: "fansly_vault", name: "Fansly — Vault / PPV Store", category: "Creator Walls & Clip Stores" },
  { id: "fansly_fyp", name: "Fansly — FYP Short Feed", category: "Creator Walls & Clip Stores" },
  { id: "manyvids_store", name: "ManyVids — Video Store", category: "Creator Walls & Clip Stores" },
  { id: "manyvids_club", name: "ManyVids — MV Club Feed", category: "Creator Walls & Clip Stores" },
  { id: "clips4sale", name: "Clips4Sale (C4S Studio)", category: "Creator Walls & Clip Stores" },
  { id: "iwantclips", name: "IWantClips (IWC Artist)", category: "Creator Walls & Clip Stores" },
  { id: "mym_fans", name: "MYM.fans (MYM Creator)", category: "Creator Walls & Clip Stores" },
  { id: "justforfans", name: "JustFor.Fans (JFF)", category: "Creator Walls & Clip Stores" },
  { id: "loyalfans_timeline", name: "LoyalFans — Timeline Wall", category: "Creator Walls & Clip Stores" },
  { id: "loyalfans_store", name: "LoyalFans — Video Store", category: "Creator Walls & Clip Stores" },
  { id: "fanvue", name: "Fanvue Creator", category: "Creator Walls & Clip Stores" },
  { id: "admireme", name: "AdmireMe.VIP", category: "Creator Walls & Clip Stores" },
  { id: "maloum", name: "Maloum Creator", category: "Creator Walls & Clip Stores" },
  { id: "boosty", name: "Boosty Creator", category: "Creator Walls & Clip Stores" },
  { id: "fancentro", name: "FanCentro Creator", category: "Creator Walls & Clip Stores" },
  { id: "slushy", name: "Slushy (9:16 Feed)", category: "Creator Walls & Clip Stores" },
  { id: "apclips", name: "APClips Store", category: "Creator Walls & Clip Stores" },
  { id: "modelhub", name: "Modelhub Store", category: "Creator Walls & Clip Stores" },
  { id: "bentbox", name: "BentBox Store", category: "Creator Walls & Clip Stores" },
  { id: "kofi", name: "Ko-fi Creator", category: "Creator Walls & Clip Stores" },
  { id: "subscribestar_adult", name: "SubscribeStar.Adult", category: "Creator Walls & Clip Stores" },
  { id: "patreon_18", name: "Patreon (18+ Creator)", category: "Creator Walls & Clip Stores" },
  { id: "fetlife", name: "FetLife", category: "Creator Walls & Clip Stores" },

  // Alt-Tech & Mainstream Video Hosts
  { id: "rumble", name: "Rumble Channel", category: "Video & Alt-Tech Hosts" },
  { id: "bitchute", name: "BitChute Channel", category: "Video & Alt-Tech Hosts" },
  { id: "odysee", name: "Odysee (LBRY) Channel", category: "Video & Alt-Tech Hosts" },
  { id: "locals", name: "Locals Community", category: "Video & Alt-Tech Hosts" },
  { id: "youtube", name: "YouTube Studio Session", category: "Video & Alt-Tech Hosts" },
  { id: "tiktok", name: "TikTok Creator Session", category: "Video & Alt-Tech Hosts" },
  { id: "twitch", name: "Twitch Creator Dashboard", category: "Video & Alt-Tech Hosts" },
  { id: "kick", name: "Kick Creator Channel", category: "Video & Alt-Tech Hosts" },
  { id: "vimeo", name: "Vimeo Creator", category: "Video & Alt-Tech Hosts" },
  { id: "dailymotion", name: "Dailymotion Partner", category: "Video & Alt-Tech Hosts" },
  { id: "bilibili", name: "Bilibili Creator", category: "Video & Alt-Tech Hosts" },
  { id: "douyin", name: "Douyin Creator", category: "Video & Alt-Tech Hosts" },

  // Social & Microblogging
  { id: "bluesky", name: "Bluesky (bsky.app) Session", category: "Social & Microblog" },
  { id: "discord", name: "Discord Web Session", category: "Social & Microblog" },
  { id: "fluxer", name: "Fluxer Web Session", category: "Social & Microblog" },
  { id: "instagram", name: "Instagram Session", category: "Social & Microblog" },
  { id: "mastodon", name: "Mastodon Web Session", category: "Social & Microblog" },
  { id: "matrix", name: "Matrix (Element Web) Session", category: "Social & Microblog" },
  { id: "nostr", name: "Nostr (Primal Web) Session", category: "Social & Microblog" },
  { id: "pinterest", name: "Pinterest Creator", category: "Social & Microblog" },
  { id: "reddit", name: "Reddit (SFW / NSFW) Session", category: "Social & Microblog" },
  { id: "rednote", name: "RedNote / Xiaohongshu", category: "Social & Microblog" },
  { id: "stoat", name: "Stoat (Revolt) Web Session", category: "Social & Microblog" },
  { id: "threads", name: "Threads Session", category: "Social & Microblog" },
  { id: "x", name: "X (Twitter) Session", category: "Social & Microblog" },

  // 18+ Video Tube Networks
  { id: "pornhub_video", name: "Pornhub — Long Video", category: "18+ Video Tubes" },
  { id: "pornhub_shorties", name: "Pornhub — Shorties (9:16)", category: "18+ Video Tubes" },
  { id: "pornhub_photos", name: "Pornhub — Community Photos", category: "18+ Video Tubes" },
  { id: "xvideos", name: "XVideos / Sheer", category: "18+ Video Tubes" },
  { id: "xhamster", name: "xHamster Creator", category: "18+ Video Tubes" },
  { id: "spankbang", name: "SpankBang Creator", category: "18+ Video Tubes" },
  { id: "eporner", name: "EPorner (4K/60fps)", category: "18+ Video Tubes" },
  { id: "redtube", name: "RedTube Creator", category: "18+ Video Tubes" },
  { id: "youporn", name: "YouPorn Creator", category: "18+ Video Tubes" },
  { id: "motherless", name: "Motherless Upload", category: "18+ Video Tubes" },
  { id: "iwara", name: "Iwara.tv (3D/Anime)", category: "18+ Video Tubes" },
  { id: "redgifs", name: "RedGIFs Creator", category: "18+ Video Tubes" },
];

export function ApiCredentialsManager({
  focusProviderId,
  onChanged,
}: {
  focusProviderId?: string | null;
  onChanged?: () => void;
}) {
  const [providers, setProviders] = useState<CredentialProvider[]>([]);
  const [cloudMode, setCloudMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [expandedId, setExpandedId] = useState<string | null>(focusProviderId || "bluesky");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ providerId: string; ok: boolean; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [letterFilter, setLetterFilter] = useState("all");

  const availableLetters = useMemo(
    () => new Set(providers.map((p) => p.name.trim().charAt(0).toUpperCase()).filter(Boolean)),
    [providers],
  );

  const filteredProviders = useMemo(
    () =>
      providers.filter((p) =>
        matchesSearchAndLetter(p.name, p.id, searchQuery, letterFilter, `${p.category} ${p.helpText}`),
      ),
    [providers, searchQuery, letterFilter],
  );

  const mergeProvidersForDisplay = (
    rawList: CredentialProvider[],
    isCloud: boolean,
  ): CredentialProvider[] => {
    if (!isCloud) return rawList;
    const clientCreds = getClientCredentials();
    const clientFlags = buildClientApiFlags(clientCreds, {});
    return rawList.map((p) => {
      const updatedFields = p.fields.map((f) => {
        const localVal = clientCreds[f.key];
        if (localVal?.trim()) {
          return {
            ...f,
            isSet: true,
            preview: maskClientPreview(localVal.trim(), f.secret),
          };
        }
        return f;
      });
      const hasAnyLocal = p.fields.some((f) => Boolean(clientCreds[f.key]?.trim()));
      const configured = Boolean(p.configured || clientFlags[p.id] || hasAnyLocal);
      return {
        ...p,
        configured,
        fields: updatedFields,
      };
    });
  };

  const applyProvidersState = (list: CredentialProvider[]) => {
    setProviders(list);
    const nextDrafts: Record<string, Record<string, string>> = {};
    for (const p of list) {
      nextDrafts[p.id] = {};
      for (const f of p.fields) {
        nextDrafts[p.id][f.key] = f.preview || "";
      }
    }
    setDrafts(nextDrafts);
  };

  const loadProviders = async () => {
    try {
      const res = await fetch("/api/credentials/manage");
      if (!res.ok) return;
      const data = await res.json();
      const isCloud = Boolean(data.cloudMode);
      setCloudMode(isCloud);
      const merged = mergeProvidersForDisplay(data.providers || [], isCloud);
      applyProvidersState(merged);
    } catch {}
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    if (focusProviderId) setExpandedId(focusProviderId);
  }, [focusProviderId]);

  const handleSave = async (providerId: string) => {
    setBusyId(providerId);
    setStatusMsg(null);
    try {
      const values = drafts[providerId] || {};
      if (cloudMode) {
        const { updatedKeys } = saveClientCredentials(values);
        notifyCredentialsChanged();
        await loadProviders();
        setStatusMsg({
          providerId,
          ok: true,
          text:
            updatedKeys.length > 0
              ? `Saved ${updatedKeys.length} key(s) privately in your browser vault (localStorage) — ready to test & publish immediately.`
              : "No new values to update. Enter or paste a key first.",
        });
        onChanged?.();
        return;
      }

      const res = await fetch("/api/credentials/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save credentials");
      if (Array.isArray(data.providers)) {
        applyProvidersState(data.providers);
      } else {
        await loadProviders();
      }
      notifyCredentialsChanged();
      setStatusMsg({
        providerId,
        ok: true,
        text: `Saved to .env (${(data.updatedKeys || []).length} field(s) updated) — live immediately!`,
      });
      onChanged?.();
    } catch (err: any) {
      setStatusMsg({ providerId, ok: false, text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (providerId: string) => {
    setBusyId(providerId);
    setStatusMsg(null);
    try {
      const values = drafts[providerId] || {};
      let clientCredentials: Record<string, string> | undefined;
      if (cloudMode) {
        clientCredentials = saveClientCredentials(values).all;
        notifyCredentialsChanged();
      } else {
        await fetch("/api/credentials/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        });
      }

      const res = await fetch("/api/credentials/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          credentials: clientCredentials,
        }),
      });
      const data = await res.json();
      setStatusMsg({
        providerId,
        ok: Boolean(data.ok),
        text: data.message || (data.ok ? "Connection verified!" : "Verification failed."),
      });
      await loadProviders();
      onChanged?.();
    } catch (err: any) {
      setStatusMsg({ providerId, ok: false, text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (providerId: string) => {
    setBusyId(providerId);
    setStatusMsg(null);
    try {
      if (cloudMode) {
        const providerDef = providers.find((p) => p.id === providerId);
        const keys = providerDef ? providerDef.fields.map((f) => f.key) : [];
        clearClientCredentialKeys(keys);
        notifyCredentialsChanged();
        await loadProviders();
        setStatusMsg({
          providerId,
          ok: true,
          text: "Cleared saved credentials from your browser storage.",
        });
        onChanged?.();
        return;
      }

      const res = await fetch(`/api/credentials/manage?provider=${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to clear keys");
      notifyCredentialsChanged();
      await loadProviders();
      setStatusMsg({ providerId, ok: true, text: "Credentials cleared from .env." });
      onChanged?.();
    } catch (err: any) {
      setStatusMsg({ providerId, ok: false, text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      {cloudMode && (
        <div className="p-3 rounded-lg bg-white text-[11px] text-[#333333] leading-relaxed">
          <strong>Private Browser Key Vault (Cloud Mode):</strong> Keys entered below stay isolated in your own browser (<code className="font-mono">localStorage</code>) per user — never written to shared server files. Enter your API tokens and click <strong>Save &amp; Test Live Connection</strong> or launch campaigns directly.
        </div>
      )}
      <div className="p-2.5 rounded-lg bg-white">
        <LetterFilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedLetter={letterFilter}
          onLetterChange={setLetterFilter}
          availableLetters={availableLetters}
          searchPlaceholder="Search API / bot keys: discord, fluxer, stoat, matrix, nostr, bluesky, mastodon..."
        />
      </div>
      {filteredProviders.length === 0 && (
        <div className="p-3 rounded-lg bg-white text-xs text-[#666666]">
          No API providers matched &ldquo;{searchQuery || letterFilter}&rdquo;. Try another letter or clear the filter.
        </div>
      )}
      <div className="ui-row-list">
        {filteredProviders.map((p) => {
          const isOpen = expandedId === p.id;
          const msg = statusMsg?.providerId === p.id ? statusMsg : null;
          return (
            <div key={p.id} className="!p-0 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : p.id)}
                className="w-full border-0 rounded-none px-4 py-3 flex items-center justify-between text-left cursor-pointer bg-white hover:font-bold"
              >
              <div>
                <span className="text-sm font-semibold text-[#333333]">{p.name}</span>
                <p className="text-[11px] text-[#999999]">{p.helpText}</p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${ p.configured ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
                >
                  {p.configured ? "CONNECTED" : "ADD KEYS"}
                </span>
                <span className="text-[#999999] text-xs">{isOpen ? "Hide" : "Configure"}</span>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-2 space-y-3 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {p.fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-[#999999] block mb-1">
                        {f.label}{" "}
                        <span className="text-[10px] font-mono text-[#999999]">({f.key})</span>
                      </label>
                      <input
                        type={f.secret ? "password" : "text"}
                        value={drafts[p.id]?.[f.key] ?? ""}
                        placeholder={f.placeholder || ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [p.id]: {
                              ...(prev[p.id] || {}),
                              [f.key]: e.target.value,
                            },
                          }))
                        }
                        className="w-full bg-white px-2.5 py-1.5 text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
                      />
                    </div>
                  ))}
                </div>

                {msg && (
                  <div
                    className={`p-2 rounded font-mono text-[11px] ${ msg.ok ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
                  >
                    {msg.text}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave(p.id)}
                    disabled={busyId === p.id}
                    className="border px-3 py-1.5 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                  >
                    {busyId === p.id ? "Saving..." : "Save Credentials"}
                  </button>
                  {p.id !== "ai_safety" && p.id !== "peertube" && (
                    <button
                      type="button"
                      onClick={() => void handleTest(p.id)}
                      disabled={busyId === p.id}
                      className="border px-3 py-1.5 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                    >
                      Save &amp; Test Live Connection
                    </button>
                  )}
                  {p.configured && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect(p.id)}
                      disabled={busyId === p.id}
                      className="border px-3 py-1.5 rounded bg-white text-[#333333] cursor-pointer border-[#cccccc] hover:font-bold"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

export function BrowserSessionConnector({
  mode = "browser",
  hideModeSwitch = false,
  initialPlatformId,
  initialAlias = "main_creator",
  vaultAliases = [],
  stealthOnline,
  showConnectedAliases = true,
  onPlatformChange,
  onAliasChange,
  onConnected,
}: {
  mode?: "browser" | "cookies";
  hideModeSwitch?: boolean;
  initialPlatformId?: string | null;
  initialAlias?: string;
  vaultAliases?: string[];
  stealthOnline?: boolean;
  showConnectedAliases?: boolean;
  onPlatformChange?: (platformId: string) => void;
  onAliasChange?: (alias: string) => void;
  onConnected?: (newAlias?: string) => void;
}) {
  const [subMode, setSubMode] = useState<"browser" | "cookies">(mode);
  const [platformId, setPlatformId] = useState(initialPlatformId || "pornhub_video");
  const [platformSearch, setPlatformSearch] = useState("");
  const [letterFilter, setLetterFilter] = useState("all");
  const [alias, setAlias] = useState(initialAlias || "main_creator");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyMap, setProxyMap] = useState<Record<string, string | null>>({});
  const [workerOffline, setWorkerOffline] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cookiesText, setCookiesText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [companionUrl, setCompanionUrl] = useState("");
  const [companionInput, setCompanionInput] = useState(DEFAULT_LOCAL_COMPANION_URL);
  const [probingCompanion, setProbingCompanion] = useState(false);

  const loadProxies = async (directUrlOverride?: string) => {
    try {
      const res = await vaultApiFetch("/api/vault/proxies", undefined, directUrlOverride);
      if (!res.ok) {
        if (res.status === 503 || res.status === 502) setWorkerOffline(true);
        return;
      }
      const data = await res.json();
      setWorkerOffline(Boolean(data.offline));
      setProxyMap(data.accounts || {});
    } catch {
      setWorkerOffline(true);
    }
  };

  const availableBrowserLetters = useMemo(
    () =>
      new Set(
        VAULT_BROWSER_PLATFORMS.map((p) => p.name.trim().charAt(0).toUpperCase()).filter(Boolean),
      ),
    [],
  );

  const filteredBrowserPlatforms = useMemo(
    () =>
      VAULT_BROWSER_PLATFORMS.filter((p) =>
        matchesSearchAndLetter(p.name, p.id, platformSearch, letterFilter, p.category),
      ),
    [platformSearch, letterFilter],
  );

  const spotlightPlatformIds = ["discord", "fluxer", "stoat", "matrix", "nostr", "bluesky", "mastodon", "pinterest"];
  const quickPickPlatforms = useMemo(() => {
    if (platformSearch.trim() || letterFilter !== "all") {
      return filteredBrowserPlatforms.slice(0, 16);
    }
    return VAULT_BROWSER_PLATFORMS.filter((p) => spotlightPlatformIds.includes(p.id));
  }, [filteredBrowserPlatforms, platformSearch, letterFilter]);

  const [copiedSpaSnippet, setCopiedSpaSnippet] = useState(false);

  const selectedSafetyCap = useMemo(() => {
    const fam = normalizePlatformFamily(platformId);
    return PLATFORM_SAFETY_CAPS.find((c) => c.id === fam) || null;
  }, [platformId]);

  const isSpaPlatform = useMemo(
    () => SPA_BROWSER_ORIGIN_PLATFORMS.has(normalizePlatformFamily(platformId)),
    [platformId],
  );

  const handleCopySpaSnippet = async () => {
    const snippet =
      "copy(JSON.stringify({cookies:[],origins:[{origin:location.origin,localStorage:Object.entries(localStorage).map(([name,value])=>({name,value}))}]}))";
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedSpaSnippet(true);
      setMsg({
        ok: true,
        text: "Copied DevTools Console snippet! Open the logged-in site -> F12 Console -> Paste & Enter -> then Ctrl+V here.",
      });
      setTimeout(() => setCopiedSpaSnippet(false), 3000);
    } catch {
      setCookiesText(snippet);
      setMsg({
        ok: true,
        text: "Clipboard blocked; snippet placed in the box temporarily for you to copy into DevTools Console.",
      });
    }
  };

  const handleSelectBrowserPlatform = (nextId: string) => {
    setPlatformId(nextId);
    onPlatformChange?.(nextId);
  };

  useEffect(() => {
    if ((platformSearch.trim() || letterFilter !== "all") && filteredBrowserPlatforms.length > 0) {
      if (!filteredBrowserPlatforms.some((p) => p.id === platformId)) {
        const firstId = filteredBrowserPlatforms[0].id;
        setPlatformId(firstId);
        onPlatformChange?.(firstId);
      }
    }
  }, [platformSearch, letterFilter, filteredBrowserPlatforms, platformId, onPlatformChange]);

  const syncCompanionAndProxies = async () => {
    const saved = getSavedCompanionUrl();
    if (saved) {
      setCompanionUrl(saved);
      setCompanionInput(saved);
    }
    const detected = await detectActiveCompanion();
    if (detected) {
      setCompanionUrl(detected.url);
      setCompanionInput(detected.url);
      setWorkerOffline(false);
      await loadProxies(detected.url);
    } else {
      setCompanionUrl("");
      await loadProxies("");
    }
  };

  useEffect(() => {
    void syncCompanionAndProxies();
    const onCompanionEvent = () => {
      void syncCompanionAndProxies();
    };
    window.addEventListener(COMPANION_CHANGED_EVENT, onCompanionEvent);
    return () => window.removeEventListener(COMPANION_CHANGED_EVENT, onCompanionEvent);
  }, []);

  const handleConnectCompanion = async (candidateUrl?: string) => {
    const target = (candidateUrl ?? companionInput).trim().replace(/\/+$/, "");
    if (!target) return;
    setProbingCompanion(true);
    setMsg(null);
    try {
      const probe = await probeCompanionUrl(target);
      if (!probe.ok) {
        setMsg({
          ok: false,
          text: `Could not reach Stealth Companion Worker at ${target}/health. Make sure the Python worker is running on port 8001.`,
        });
        return;
      }
      setSavedCompanionUrl(target);
      setCompanionUrl(target);
      setCompanionInput(target);
      setWorkerOffline(false);
      notifyCompanionChanged();
      await loadProxies(target);
      setMsg({
        ok: true,
        text: `Connected directly to Companion Worker at ${target} (${probe.profiles.length} vaulted profile(s) ready).`,
      });
      onConnected?.();
    } finally {
      setProbingCompanion(false);
    }
  };

  useEffect(() => {
    setSubMode(mode);
  }, [mode]);

  useEffect(() => {
    if (initialPlatformId) {
      const hit = VAULT_BROWSER_PLATFORMS.find((p) => p.id === initialPlatformId);
      if (hit) setPlatformId(hit.id);
    }
    if (initialAlias) setAlias(initialAlias);
    setMsg(null);
  }, [initialPlatformId, initialAlias]);

  const saveAccountProxyIfTyped = async (cleanAlias: string) => {
    if (!proxyUrl.trim()) return;
    await vaultApiFetch("/api/vault/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: cleanAlias, proxy_url: proxyUrl.trim() }),
    }).catch(() => {});
    await loadProxies();
  };

  const handleSaveProxyOnly = async (clear = false) => {
    const cleanAlias = alias.trim();
    if (!cleanAlias) return;
    setSavingProxy(true);
    try {
      const res = await vaultApiFetch("/api/vault/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: cleanAlias,
          proxy_url: clear ? "" : proxyUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to save proxy");
      if (data.accounts) {
        setProxyMap(data.accounts);
      } else {
        await loadProxies();
      }
      if (clear) setProxyUrl("");
      setMsg({
        ok: true,
        text: clear
          ? `Cleared sticky proxy for '${cleanAlias}' (using Direct IP).`
          : `Saved sticky proxy (${data.proxy || proxyUrl.trim()}) for '${cleanAlias}'.`,
      });
      onConnected?.(cleanAlias);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSavingProxy(false);
    }
  };

  const handleTestProxy = async () => {
    const cleanAlias = alias.trim();
    const targetProxy = proxyUrl.trim() || proxyMap[cleanAlias] || "";
    if (!targetProxy || targetProxy.includes("***")) {
      setMsg({ ok: false, text: "Paste the proxy URL in the input field to test its live connectivity." });
      return;
    }
    setSavingProxy(true);
    try {
      const res = await vaultApiFetch("/api/vault/proxies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: cleanAlias || "default", proxy_url: targetProxy }),
      });
      const data = await res.json();
      setMsg({
        ok: Boolean(data.ok),
        text: data.message || data.error || data.detail || "Proxy test finished.",
      });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSavingProxy(false);
    }
  };

  const launchBrowserLogin = async () => {
    const cleanAlias = alias.trim();
    if (!cleanAlias) {
      setMsg({ ok: false, text: "Type an account alias first (e.g. main_creator)." });
      return;
    }
    setConnecting(true);
    await saveAccountProxyIfTyped(cleanAlias);
    setMsg({
      ok: true,
      text: `Opening Chrome browser for '${platformId}' as '${cleanAlias}'... Sign in inside that window, then either close Chrome or click "Finish & Save Cookies Now".`,
    });
    try {
      const res = await vaultApiFetch("/api/vault/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: cleanAlias,
          platform: platformId,
          headless: false,
          timeout_sec: 180,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Stealth browser login failed");
      if (data.success) {
        setMsg({
          ok: true,
          text: `Connected '${cleanAlias}' (${data.status})! Captured ${data.cookie_count} cookies into ./profiles/${cleanAlias}.`,
        });
        onConnected?.(cleanAlias);
      } else {
        setMsg({
          ok: false,
          text: `Browser closed (${data.status}). Cookies captured: ${data.cookie_count}. Complete login before closing, or use Paste Cookies JSON.`,
        });
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setConnecting(false);
      setFinishing(false);
    }
  };

  const finishActiveLoginNow = async () => {
    const cleanAlias = alias.trim();
    if (!cleanAlias) return;
    setFinishing(true);
    try {
      const res = await vaultApiFetch("/api/vault/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: cleanAlias }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Could not signal active Chrome login.");
      setMsg({ ok: true, text: `Saving cookies for '${cleanAlias}' and closing Chrome...` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
      setFinishing(false);
    }
  };

  const handleCookieFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCookiesText(text);
      setMsg({ ok: true, text: `Loaded ${file.name}. Click "Import & Save Session to Vault" below.` });
    } catch (err: any) {
      setMsg({ ok: false, text: `Failed to read file: ${err.message}` });
    } finally {
      e.target.value = "";
    }
  };

  const importCookiesJson = async () => {
    const cleanAlias = alias.trim();
    if (!cleanAlias) {
      setMsg({ ok: false, text: "Type an account alias first (e.g. main_creator)." });
      return;
    }
    if (!cookiesText.trim()) {
      setMsg({ ok: false, text: "Paste Cookie-Editor JSON array or Playwright storage_state JSON first." });
      return;
    }
    setImporting(true);
    try {
      await saveAccountProxyIfTyped(cleanAlias);
      const res = await vaultApiFetch("/api/vault/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: cleanAlias,
          platform: platformId,
          cookies_json: cookiesText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to import cookies");
      const importedOrigins = Number(data.origin_count || 0);
      setMsg({
        ok: true,
        text:
          importedOrigins > 0 && Number(data.cookie_count || 0) === 0
            ? `Imported ${importedOrigins} SPA storage origin(s) into ./profiles/${cleanAlias}! Ready to post & inspect DOM.`
            : `Imported ${data.cookie_count} cookies${importedOrigins > 0 ? ` + ${importedOrigins} SPA origins` : ""} into ./profiles/${cleanAlias}! Ready to post & inspect DOM.`,
      });
      setCookiesText("");
      onConnected?.(cleanAlias);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setImporting(false);
    }
  };

  const isStealthOffline = !companionUrl && (stealthOnline === false || workerOffline);

  return (
    <div className="space-y-4 text-xs">
      {companionUrl && (
        <div className="p-3 rounded-xl bg-white text-[#333333] flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span>
            <strong>Direct Browser Companion Connected:</strong> <code className="font-mono text-[#333333]">{companionUrl}</code> (Chrome logins &amp; encrypted Vault actions run directly on your machine).
          </span>
          <button
            type="button"
            onClick={() => {
              setSavedCompanionUrl("");
              setCompanionUrl("");
              notifyCompanionChanged();
              void loadProxies("");
            }}
            className="px-2 py-0.5 rounded bg-white text-[#666666] border cursor-pointer border-[#cccccc] hover:font-bold"
          >
            Disconnect Companion
          </button>
        </div>
      )}
      {isStealthOffline && (
        <div className="p-3.5 rounded-xl bg-white text-[#333333] space-y-2.5">
          <div className="font-semibold text-[#333333]">
            Companion Stealth Worker Required for Chrome Login &amp; Cookie Vault
          </div>
          <p className="text-[11px] text-[#333333] leading-relaxed">
            Chrome sessions, proxies, and browser uploads stay on your machine (safer than datacenter IPs). Run <code className="px-1 py-0.5 rounded bg-white text-[#333333] font-mono">npm run companion</code> locally and this hosted page connects directly to <code className="px-1 py-0.5 rounded bg-white text-[#333333] font-mono">http://127.0.0.1:8001</code>:
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={companionInput}
              onChange={(e) => setCompanionInput(e.target.value)}
              placeholder="http://127.0.0.1:8001 or https://your-tunnel.trycloudflare.com"
              className="flex-1 min-w-[220px] bg-white px-2.5 py-1.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
            />
            <button
              type="button"
              disabled={probingCompanion || !companionInput.trim()}
              onClick={() => void handleConnectCompanion()}
              className="border px-3 py-1.5 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              {probingCompanion ? "Checking..." : "Connect Companion"}
            </button>
            <button
              type="button"
              disabled={probingCompanion}
              onClick={() => {
                setCompanionInput(DEFAULT_LOCAL_COMPANION_URL);
                void handleConnectCompanion(DEFAULT_LOCAL_COMPANION_URL);
              }}
              className="px-2.5 py-1.5 rounded bg-white text-[#333333] border font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              Auto-Detect :8001
            </button>
          </div>
        </div>
      )}
      <div className="p-4 rounded-xl bg-white space-y-3">
        {!hideModeSwitch && (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSubMode("browser")}
                className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ subMode === "browser" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
              >
                Interactive Chrome Login
              </button>
              <button
                type="button"
                onClick={() => setSubMode("cookies")}
                className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ subMode === "cookies" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
              >
                Paste Cookies JSON (Cookie-Editor)
              </button>
            </div>
            <span className="text-[11px] text-[#999999]">Saved encrypted inside ./profiles/&lt;alias&gt;</span>
          </div>
        )}

        <div className="rounded bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#666666]">
            <span>Find site by name or starting letter ({filteredBrowserPlatforms.length} / {VAULT_BROWSER_PLATFORMS.length} portals):</span>
            {(platformSearch || letterFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setPlatformSearch("");
                  setLetterFilter("all");
                }}
                className="rounded border bg-white px-2 py-0.5 text-[10px] text-[#666666] hover:text-[#333333] cursor-pointer border-[#cccccc] hover:font-bold"
              >
                Reset Filter
              </button>
            )}
          </div>
          <LetterFilterBar
            searchQuery={platformSearch}
            onSearchChange={setPlatformSearch}
            selectedLetter={letterFilter}
            onLetterChange={(nextLetter) => {
              setLetterFilter(nextLetter);
              if (nextLetter !== "all") {
                const firstMatch = VAULT_BROWSER_PLATFORMS.find((p) =>
                  matchesSearchAndLetter(p.name, p.id, platformSearch, nextLetter, p.category),
                );
                if (firstMatch && firstMatch.id !== platformId) {
                  handleSelectBrowserPlatform(firstMatch.id);
                }
              }
            }}
            availableLetters={availableBrowserLetters}
            searchPlaceholder="Search browser login portals: fluxer, discord, stoat, matrix, nostr, bluesky, mastodon, pinterest..."
          />
          {quickPickPlatforms.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {quickPickPlatforms.map((qp) => {
                const isActive = platformId === qp.id;
                return (
                  <button
                    key={qp.id}
                    type="button"
                    onClick={() => handleSelectBrowserPlatform(qp.id)}
                    className={`bg-white px-2 py-0.5 text-[11px] cursor-pointer border border-[#cccccc] rounded hover:font-bold ${
                      isActive ? "font-bold text-[#333333]" : "text-[#666666] hover:font-bold hover:text-[#333333]"
                    }`}
                  >
                    {qp.name.replace(/\s+Session$|\s+Web Session$/, "")}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[#999999] block mb-1">
              Which site is this account for? ({filteredBrowserPlatforms.length} shown of {VAULT_BROWSER_PLATFORMS.length} portals)
            </label>
            <select
              value={
                filteredBrowserPlatforms.some((p) => p.id === platformId)
                  ? platformId
                  : (filteredBrowserPlatforms[0]?.id ?? platformId)
              }
              onChange={(e) => handleSelectBrowserPlatform(e.target.value)}
              className="w-full bg-white px-3 py-2 text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
            >
              {filteredBrowserPlatforms.length === 0 ? (
                <option value={platformId}>No portals match filter</option>
              ) : (
                Array.from(new Set(filteredBrowserPlatforms.map((p) => p.category))).map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {filteredBrowserPlatforms
                      .filter((p) => p.category === cat)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </optgroup>
                ))
              )}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[#999999]">Account Alias Name (1 per account):</label>
              <button
                type="button"
                onClick={() => {
                  const prefix = platformId.split("_")[0];
                  let idx = 1;
                  while (
                    vaultAliases.includes(`${prefix}_acc_${idx}`) ||
                    alias.trim() === `${prefix}_acc_${idx}`
                  ) {
                    idx++;
                  }
                  const next = `${prefix}_acc_${idx}`;
                  setAlias(next);
                  onAliasChange?.(next);
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-white text-[#333333] border font-mono cursor-pointer border-[#cccccc] hover:font-bold"
                title="Auto-generate a fresh alias for a 2nd, 5th, or 10th account on this platform"
              >
                + Next Account Alias (#2, #3...)
              </button>
            </div>
            <input
              type="text"
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
                onAliasChange?.(e.target.value);
              }}
              placeholder="e.g. main_creator, x_acc_1, x_acc_2..."
              className="w-full bg-white px-3 py-2 text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
            />
            <p className="text-[10px] text-[#999999] mt-1">
              Want multiple accounts on the same platform? Click <strong>+ Next Account Alias</strong> to create <code className="text-[#666666]">{platformId.split("_")[0]}_acc_1</code>, <code className="text-[#666666]">{platformId.split("_")[0]}_acc_2</code>, etc.
            </p>
            {selectedSafetyCap && (
              <div className="mt-1.5 rounded bg-white px-2.5 py-1.5 text-[10px] text-[#666666] leading-snug">
                <span className="font-semibold text-[#333333]">Anti-Ban Cap ({selectedSafetyCap.name}):</span>{" "}
                {selectedSafetyCap.safeAccountsPerIp} accounts/IP · {selectedSafetyCap.maxPostsPerDayPerAccount} · &gt;= {selectedSafetyCap.minGapMinutes}m gap.{" "}
                <span className="text-[#999999]">{selectedSafetyCap.connectionAdvice}</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-white space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[#666666] font-medium text-[11px]">
              Dedicated Sticky Proxy for <code className="text-[#333333] font-mono">{alias || "alias"}</code> (Recommended when running 3–10+ accounts):
            </label>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white text-[#333333]">
              {proxyMap[alias.trim()] ? `Active: ${proxyMap[alias.trim()]}` : "Current: Direct IP"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="Optional: http://user:pass@ip:port or socks5://user:pass@ip:port"
              className="flex-1 min-w-[220px] bg-white px-2.5 py-1.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
            />
            <button
              type="button"
              disabled={savingProxy || !proxyUrl.trim()}
              onClick={() => void handleTestProxy()}
              className="border px-2.5 py-1.5 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              Test Proxy
            </button>
            <button
              type="button"
              disabled={savingProxy || !proxyUrl.trim()}
              onClick={() => void handleSaveProxyOnly(false)}
              className="border px-2.5 py-1.5 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              {savingProxy ? "Saving..." : "Pin Proxy"}
            </button>
            {proxyMap[alias.trim()] && (
              <button
                type="button"
                disabled={savingProxy}
                onClick={() => void handleSaveProxyOnly(true)}
                className="px-2.5 py-1.5 rounded bg-white text-[#333333] border cursor-pointer border-[#cccccc] hover:font-bold"
              >
                Use Direct IP
              </button>
            )}
          </div>
        </div>

        {subMode === "browser" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-[#999999] leading-relaxed">
              1. Click <strong>Open Chrome to Sign In</strong>. 2. Log in (solve any CAPTCHA or 2FA) inside the opened window.
              3. Cookies save automatically once logged in, or click <strong>Finish &amp; Save Cookies Now</strong> / close Chrome.
              {platformId === "youtube" && (
                <span className="block mt-1 text-[#333333]">
                  Tip for Google / YouTube: If Google asks to verify or blocks embedded sign-in, switch to <strong>2. Paste Cookies JSON</strong> and paste cookies exported from your logged-in desktop browser.
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void launchBrowserLogin()}
                disabled={connecting}
                className="border flex-1 py-2.5 px-4 rounded-lg bg-white text-[#333333] font-bold text-sm cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
              >
                {connecting ? "Waiting for sign-in inside Chrome..." : "Open Chrome to Sign In"}
              </button>
              {connecting && (
                <button
                  type="button"
                  onClick={() => void finishActiveLoginNow()}
                  disabled={finishing}
                  className="border py-2.5 px-4 rounded-lg bg-white text-[#333333] font-bold text-sm cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                >
                  {finishing ? "Saving..." : "Finish & Save Cookies Now"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-2.5 rounded bg-white text-[11px] text-[#666666] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[#333333]">Fastest fallback if Chrome blocks login or runs headless:</div>
                {isSpaPlatform && (
                  <button
                    type="button"
                    onClick={() => void handleCopySpaSnippet()}
                    className="rounded border bg-white px-2 py-0.5 text-[10px] font-semibold text-[#333333] cursor-pointer border-[#cccccc] hover:font-bold"
                  >
                    {copiedSpaSnippet ? "Copied DevTools Snippet" : "Copy DevTools SPA Extractor"}
                  </button>
                )}
              </div>
              <ol className="list-decimal list-inside space-y-0.5 text-[#999999]">
                <li>Log into your account in your everyday Chrome / Edge / Firefox browser.</li>
                <li>
                  {isSpaPlatform
                    ? "For SPA apps (Discord, Fluxer, Stoat, Element, Primal, Bluesky), click Copy DevTools SPA Extractor, run it in F12 Console on the logged-in tab, or export Playwright storage_state.json."
                    : "Install the free Cookie-Editor extension -> click Export -> Export as JSON (or load Playwright storage_state.json)."}
                </li>
                <li>Paste that JSON below (supports Cookie-Editor arrays AND Playwright <code className="text-[#333333]">origins</code> / <code className="text-[#333333]">localStorage</code>) and save.</li>
              </ol>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[#999999]">Cookie-Editor JSON array or Playwright storage_state JSON:</label>
              <label className="px-2.5 py-1 rounded bg-white text-[#333333] cursor-pointer border border-[#cccccc]">
                Load .json File
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void handleCookieFileUpload(e)}
                  className="hidden border-0 border-b border-[#cccccc] rounded-none bg-white"
                />
              </label>
            </div>
            <textarea
              rows={5}
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              placeholder='[{"name": "sessionid", "value": "...", "domain": ".example.com", "path": "/"}]'
              className="w-full bg-white p-2.5 text-[#333333] font-mono text-[11px] border-0 border-b border-[#cccccc] rounded-none"
            />
            <button
              type="button"
              onClick={() => void importCookiesJson()}
              disabled={importing}
              className="border w-full py-2.5 px-4 rounded-lg bg-white text-[#333333] font-bold text-sm cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              {importing ? "Encrypting & Importing..." : "Import & Save Session to Vault"}
            </button>
          </div>
        )}

        {msg && (
          <div
            className={`p-3 rounded font-mono text-[11px] ${ msg.ok ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {showConnectedAliases && (
        <div className="p-4 rounded-xl bg-white space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#333333]">
              Already Connected Browser Aliases ({vaultAliases.length}) — click to select:
            </span>
            <a href="/vault" className="text-[#333333] no-underline font-medium hover:font-bold">
              Manage Health &amp; DOM Selectors in Vault -&gt;
            </a>
          </div>
          {vaultAliases.length === 0 ? (
            <p className="text-[#999999]">None connected yet. Pick a site above and sign in or import cookies.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vaultAliases.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => {
                    setAlias(a);
                    onAliasChange?.(a);
                  }}
                  className={`px-2.5 py-1 rounded border font-mono cursor-pointer transition-colors border-[#cccccc] bg-white hover:font-bold ${ alias.trim() === a ? "bg-white border-[#cccccc] text-[#333333] font-bold" : "bg-white border-[#cccccc] text-[#333333] hover:bg-white" }`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountConnectModal({
  open,
  initialTab = "oneclick",
  initialPlatformId,
  initialProviderId,
  initialAlias = "main_creator",
  vaultAliases,
  onClose,
  onConnected,
}: {
  open: boolean;
  initialTab?: "oneclick" | "browser" | "api" | "cookies";
  initialPlatformId?: string | null;
  initialProviderId?: string | null;
  initialAlias?: string;
  vaultAliases: string[];
  onClose: () => void;
  onConnected: (newAlias?: string) => void;
}) {
  const [tab, setTab] = useState<"oneclick" | "browser" | "api" | "cookies">(initialTab);
  const [focusProvider, setFocusProvider] = useState<string | null | undefined>(initialProviderId);
  const [browserTarget, setBrowserTarget] = useState<string | null | undefined>(initialPlatformId);
  const [modalApiFlags, setModalApiFlags] = useState<Record<string, boolean>>({});
  const [modalCloudMode, setModalCloudMode] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setFocusProvider(initialProviderId);
    setBrowserTarget(initialPlatformId);
    setModalApiFlags(buildClientApiFlags(getClientCredentials(), {}));
    fetch("/api/credentials/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.cloudMode) setModalCloudMode(true);
        if (data?.apiCredentials) {
          setModalApiFlags(buildClientApiFlags(getClientCredentials(), data.apiCredentials));
        }
      })
      .catch(() => {});
  }, [open, initialTab, initialProviderId, initialPlatformId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-[0_12px_36px_rgba(0,0,0,0.08)]">
        <div className="flex items-start justify-between gap-4 pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#333333]">Connect Your Real Accounts</h2>
            <p className="text-xs text-[#666666] mt-1">
              Use <strong className="text-[#333333]">1-Click Sign-Up</strong> (Google, Discord, Fluxer, Stoat, Bluesky, X, Nostr, Mastodon) or <strong className="text-[#333333]">Chrome Login / Cookies</strong> for web portals.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border bg-white text-xs text-[#333333] font-medium cursor-pointer border-[#cccccc] hover:font-bold"
          >
            Done
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTab("oneclick")}
            className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ tab === "oneclick" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
          >
            0. 1-Click Sign-Up
          </button>
          <button
            type="button"
            onClick={() => setTab("browser")}
            className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ tab === "browser" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
          >
            1. Chrome Login Window
          </button>
          <button
            type="button"
            onClick={() => setTab("cookies")}
            className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ tab === "cookies" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
          >
            2. Paste Cookies JSON
          </button>
          <button
            type="button"
            onClick={() => setTab("api")}
            className={`px-3 py-1.5 bg-white cursor-pointer border border-[#cccccc] rounded hover:font-bold ${ tab === "api" ? "font-bold text-[#333333]" : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]" }`}
          >
            3. All API / Bot Keys
          </button>
        </div>

        {tab === "oneclick" ? (
          <OneClickConnectPanel
            apiFlags={modalApiFlags}
            cloudMode={modalCloudMode}
            onConnected={(creds) => {
              notifyCredentialsChanged();
              setModalApiFlags((prev) => buildClientApiFlags(creds, prev));
              onConnected();
            }}
            onSelectProvider={(pid) => {
              setFocusProvider(pid);
              setTab("api");
            }}
            onOpenBrowserLogin={(pid) => {
              setBrowserTarget(pid);
              setTab("browser");
            }}
          />
        ) : tab === "api" ? (
          <ApiCredentialsManager focusProviderId={focusProvider} onChanged={() => onConnected()} />
        ) : (
          <BrowserSessionConnector
            mode={tab === "cookies" ? "cookies" : "browser"}
            hideModeSwitch={true}
            initialPlatformId={browserTarget}
            initialAlias={initialAlias}
            vaultAliases={vaultAliases}
            onConnected={onConnected}
          />
        )}
      </div>
    </div>
  );
}

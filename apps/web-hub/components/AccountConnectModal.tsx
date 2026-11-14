"use client";

import React, { useEffect, useState } from "react";

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
  { id: "x", name: "X (Twitter) Session", category: "Social & Microblog" },
  { id: "instagram", name: "Instagram Session", category: "Social & Microblog" },
  { id: "threads", name: "Threads Session", category: "Social & Microblog" },
  { id: "reddit", name: "Reddit (SFW / NSFW) Session", category: "Social & Microblog" },
  { id: "pinterest", name: "Pinterest Creator", category: "Social & Microblog" },
  { id: "rednote", name: "RedNote / Xiaohongshu", category: "Social & Microblog" },

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
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [expandedId, setExpandedId] = useState<string | null>(focusProviderId || "bluesky");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ providerId: string; ok: boolean; text: string } | null>(null);

  const loadProviders = async () => {
    try {
      const res = await fetch("/api/credentials/manage");
      if (!res.ok) return;
      const data = await res.json();
      const list: CredentialProvider[] = data.providers || [];
      setProviders(list);
      const nextDrafts: Record<string, Record<string, string>> = {};
      for (const p of list) {
        nextDrafts[p.id] = {};
        for (const f of p.fields) {
          nextDrafts[p.id][f.key] = f.preview || "";
        }
      }
      setDrafts(nextDrafts);
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
      const res = await fetch("/api/credentials/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save credentials");
      if (Array.isArray(data.providers)) {
        setProviders(data.providers);
      } else {
        await loadProviders();
      }
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
      // Save any typed unsaved fields first so clicking Test works in one click
      const values = drafts[providerId] || {};
      await fetch("/api/credentials/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });

      const res = await fetch("/api/credentials/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
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
      const res = await fetch(`/api/credentials/manage?provider=${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to clear keys");
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
      {providers.map((p) => {
        const isOpen = expandedId === p.id;
        const msg = statusMsg?.providerId === p.id ? statusMsg : null;
        return (
          <div key={p.id} className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : p.id)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 cursor-pointer"
            >
              <div>
                <span className="text-sm font-semibold text-white">{p.name}</span>
                <p className="text-[11px] text-slate-400">{p.helpText}</p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                    p.configured
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                      : "bg-slate-900 text-amber-300 border border-amber-800/60"
                  }`}
                >
                  {p.configured ? "CONNECTED" : "ADD KEYS"}
                </span>
                <span className="text-slate-500 text-xs">{isOpen ? "Hide" : "Configure"}</span>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 space-y-3 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {p.fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-slate-400 block mb-1">
                        {f.label}{" "}
                        <span className="text-[10px] font-mono text-slate-500">({f.key})</span>
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
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
                      />
                    </div>
                  ))}
                </div>

                {msg && (
                  <div
                    className={`p-2 rounded border font-mono text-[11px] ${
                      msg.ok
                        ? "bg-emerald-950/60 border-emerald-700 text-emerald-200"
                        : "bg-red-950/60 border-red-700 text-red-200"
                    }`}
                  >
                    {msg.text}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSave(p.id)}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {busyId === p.id ? "Saving..." : "Save Credentials"}
                  </button>
                  {p.id !== "ai_safety" && p.id !== "peertube" && (
                    <button
                      type="button"
                      onClick={() => void handleTest(p.id)}
                      disabled={busyId === p.id}
                      className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Save &amp; Test Live Connection
                    </button>
                  )}
                  {p.configured && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect(p.id)}
                      disabled={busyId === p.id}
                      className="px-3 py-1.5 rounded bg-slate-900 hover:bg-red-950 text-red-400 cursor-pointer"
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
  );
}

export function BrowserSessionConnector({
  mode = "browser",
  hideModeSwitch = false,
  initialPlatformId,
  initialAlias = "main_creator",
  vaultAliases = [],
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
  showConnectedAliases?: boolean;
  onPlatformChange?: (platformId: string) => void;
  onAliasChange?: (alias: string) => void;
  onConnected?: (newAlias?: string) => void;
}) {
  const [subMode, setSubMode] = useState<"browser" | "cookies">(mode);
  const [platformId, setPlatformId] = useState(initialPlatformId || "pornhub_video");
  const [alias, setAlias] = useState(initialAlias || "main_creator");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyMap, setProxyMap] = useState<Record<string, string | null>>({});
  const [savingProxy, setSavingProxy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cookiesText, setCookiesText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadProxies = async () => {
    try {
      const res = await fetch("/api/vault/proxies");
      if (!res.ok) return;
      const data = await res.json();
      setProxyMap(data.accounts || {});
    } catch {}
  };

  useEffect(() => {
    void loadProxies();
  }, []);

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
    await fetch("/api/vault/proxies", {
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
      const res = await fetch("/api/vault/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: cleanAlias,
          proxy_url: clear ? "" : proxyUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to save proxy");
      setProxyMap(data.accounts || {});
      if (clear) setProxyUrl("");
      setMsg({
        ok: true,
        text: clear
          ? `Cleared sticky proxy for '${cleanAlias}' (using Direct IP).`
          : `Saved sticky proxy (${data.proxy}) for '${cleanAlias}' in config/account-settings.json!`,
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
      const res = await fetch("/api/vault/proxies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: cleanAlias || "default", proxy_url: targetProxy }),
      });
      const data = await res.json();
      setMsg({
        ok: Boolean(data.ok),
        text: data.message || data.error || "Proxy test finished.",
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
      const res = await fetch("/api/vault/login", {
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
      if (!res.ok) throw new Error(data.detail || "Stealth browser login failed");
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
      const res = await fetch("/api/vault/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: cleanAlias }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not signal active Chrome login.");
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
      const res = await fetch("/api/vault/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: cleanAlias,
          platform: platformId,
          cookies_json: cookiesText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to import cookies");
      setMsg({
        ok: true,
        text: `Imported ${data.cookie_count} cookies into ./profiles/${cleanAlias}! Ready to post & inspect DOM.`,
      });
      setCookiesText("");
      onConnected?.(cleanAlias);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        {!hideModeSwitch && (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSubMode("browser")}
                className={`px-3 py-1.5 rounded font-semibold cursor-pointer ${
                  subMode === "browser"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800"
                }`}
              >
                Interactive Chrome Login
              </button>
              <button
                type="button"
                onClick={() => setSubMode("cookies")}
                className={`px-3 py-1.5 rounded font-semibold cursor-pointer ${
                  subMode === "cookies"
                    ? "bg-violet-600 text-white"
                    : "bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800"
                }`}
              >
                Paste Cookies JSON (Cookie-Editor)
              </button>
            </div>
            <span className="text-[11px] text-slate-500">Saved encrypted inside ./profiles/&lt;alias&gt;</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 block mb-1">
              Which site is this account for? ({VAULT_BROWSER_PLATFORMS.length} supported portals)
            </label>
            <select
              value={platformId}
              onChange={(e) => {
                setPlatformId(e.target.value);
                onPlatformChange?.(e.target.value);
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-white"
            >
              {Array.from(new Set(VAULT_BROWSER_PLATFORMS.map((p) => p.category))).map((cat) => (
                <optgroup key={cat} label={cat}>
                  {VAULT_BROWSER_PLATFORMS.filter((p) => p.category === cat).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400">Account Alias Name (1 per account):</label>
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
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/70 font-mono cursor-pointer"
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
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-white font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Want 5–10 accounts on the same platform (e.g. X, OnlyFans, Clips4Sale)? Click <strong>+ Next Account Alias</strong> to create <code className="text-slate-300">{platformId.split("_")[0]}_acc_1</code>, <code className="text-slate-300">{platformId.split("_")[0]}_acc_2</code>, etc.
            </p>
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-slate-300 font-medium text-[11px]">
              Dedicated Sticky Proxy for <code className="text-indigo-300 font-mono">{alias || "alias"}</code> (Recommended when running 3–10+ accounts):
            </label>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300">
              {proxyMap[alias.trim()] ? `Active: ${proxyMap[alias.trim()]}` : "Current: Direct IP"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="Optional: http://user:pass@ip:port or socks5://user:pass@ip:port"
              className="flex-1 min-w-[220px] bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-[11px]"
            />
            <button
              type="button"
              disabled={savingProxy || !proxyUrl.trim()}
              onClick={() => void handleTestProxy()}
              className="px-2.5 py-1.5 rounded bg-indigo-900/70 hover:bg-indigo-800 text-indigo-200 font-semibold cursor-pointer disabled:opacity-50"
            >
              Test Proxy
            </button>
            <button
              type="button"
              disabled={savingProxy || !proxyUrl.trim()}
              onClick={() => void handleSaveProxyOnly(false)}
              className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingProxy ? "Saving..." : "Pin Proxy"}
            </button>
            {proxyMap[alias.trim()] && (
              <button
                type="button"
                disabled={savingProxy}
                onClick={() => void handleSaveProxyOnly(true)}
                className="px-2.5 py-1.5 rounded bg-slate-950 hover:bg-red-950 text-red-300 border border-red-900/60 cursor-pointer"
              >
                Use Direct IP
              </button>
            )}
          </div>
        </div>

        {subMode === "browser" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              1. Click <strong>Open Chrome to Sign In</strong>. 2. Log in (solve any CAPTCHA or 2FA) inside the opened window.
              3. Cookies save automatically once logged in, or click <strong>Finish &amp; Save Cookies Now</strong> / close Chrome.
              {platformId === "youtube" && (
                <span className="block mt-1 text-amber-300">
                  Tip for Google / YouTube: If Google asks to verify or blocks embedded sign-in, switch to <strong>2. Paste Cookies JSON</strong> and paste cookies exported from your logged-in desktop browser.
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void launchBrowserLogin()}
                disabled={connecting}
                className="flex-1 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50"
              >
                {connecting ? "Waiting for sign-in inside Chrome..." : "Open Chrome to Sign In"}
              </button>
              {connecting && (
                <button
                  type="button"
                  onClick={() => void finishActiveLoginNow()}
                  disabled={finishing}
                  className="py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50"
                >
                  {finishing ? "Saving..." : "Finish & Save Cookies Now"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
              <div className="font-semibold text-violet-300">Fastest fallback if Chrome blocks login or runs headless:</div>
              <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
                <li>Log into your account in your everyday Chrome / Edge / Firefox browser.</li>
                <li>Install the free <strong>Cookie-Editor</strong> extension -&gt; click <strong>Export</strong> -&gt; <strong>Export as JSON</strong>.</li>
                <li>Paste that JSON below (or load a Playwright <code className="text-slate-200">storage_state.json</code> file) and save.</li>
              </ol>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-slate-400">Cookie-Editor JSON array or Playwright storage_state JSON:</label>
              <label className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer border border-slate-700">
                Load .json File
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void handleCookieFileUpload(e)}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={5}
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              placeholder='[{"name": "sessionid", "value": "...", "domain": ".example.com", "path": "/"}]'
              className="w-full bg-slate-900 border border-slate-800 rounded p-2.5 text-slate-200 font-mono text-[11px]"
            />
            <button
              type="button"
              onClick={() => void importCookiesJson()}
              disabled={importing}
              className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              {importing ? "Encrypting & Importing..." : "Import & Save Session to Vault"}
            </button>
          </div>
        )}

        {msg && (
          <div
            className={`p-3 rounded border font-mono text-[11px] ${
              msg.ok
                ? "bg-emerald-950/60 border-emerald-700 text-emerald-200"
                : "bg-red-950/60 border-red-700 text-red-200"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>

      {showConnectedAliases && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">
              Already Connected Browser Aliases ({vaultAliases.length}) — click to select:
            </span>
            <a href="/vault" className="text-indigo-400 underline">
              Manage Health &amp; DOM Selectors in Vault -&gt;
            </a>
          </div>
          {vaultAliases.length === 0 ? (
            <p className="text-slate-500">None connected yet. Pick a site above and sign in or import cookies.</p>
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
                  className={`px-2.5 py-1 rounded border font-mono cursor-pointer transition-colors ${
                    alias.trim() === a
                      ? "bg-indigo-600 border-indigo-400 text-white font-bold"
                      : "bg-emerald-950/50 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60"
                  }`}
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
  initialTab = "browser",
  initialPlatformId,
  initialProviderId,
  initialAlias = "main_creator",
  vaultAliases,
  onClose,
  onConnected,
}: {
  open: boolean;
  initialTab?: "browser" | "api" | "cookies";
  initialPlatformId?: string | null;
  initialProviderId?: string | null;
  initialAlias?: string;
  vaultAliases: string[];
  onClose: () => void;
  onConnected: (newAlias?: string) => void;
}) {
  const [tab, setTab] = useState<"browser" | "api" | "cookies">(initialTab);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border-2 border-indigo-500 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Connect Your Real Accounts</h2>
            <p className="text-xs text-slate-400 mt-1">
              Use <strong>Browser Login</strong> or <strong>Paste Cookies JSON</strong> for web portals (Pornhub, Fansly, OnlyFans, X, Instagram, YouTube, TikTok) or <strong>API / Bot Keys</strong> for direct APIs (Bluesky, Telegram, Discord, Mastodon, Reddit, e621, etc.).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
          >
            Done
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTab("browser")}
            className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer ${
              tab === "browser" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            1. Chrome Login Window
          </button>
          <button
            type="button"
            onClick={() => setTab("cookies")}
            className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer ${
              tab === "cookies" ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            2. Paste Cookies JSON
          </button>
          <button
            type="button"
            onClick={() => setTab("api")}
            className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer ${
              tab === "api" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            3. API / Bot Keys (Bluesky, Telegram...)
          </button>
        </div>

        {tab === "api" ? (
          <ApiCredentialsManager focusProviderId={initialProviderId} onChanged={() => onConnected()} />
        ) : (
          <BrowserSessionConnector
            mode={tab === "cookies" ? "cookies" : "browser"}
            hideModeSwitch={true}
            initialPlatformId={initialPlatformId}
            initialAlias={initialAlias}
            vaultAliases={vaultAliases}
            onConnected={onConnected}
          />
        )}
      </div>
    </div>
  );
}

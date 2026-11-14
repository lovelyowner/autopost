"use client";

import React, { useEffect, useState } from "react";
import {
  ApiCredentialsManager,
  BrowserSessionConnector,
  VAULT_BROWSER_PLATFORMS,
} from "../../components/AccountConnectModal";

interface ProfileItem {
  account_id: string;
  platform?: string;
  platforms?: string[];
  proxy?: string | null;
  proxy_ok?: boolean;
  proxy_latency_ms?: number | null;
  cookie_count?: number;
  domains?: string[];
  updated_at?: number;
  encrypted?: boolean;
  healthy?: boolean;
  statusText?: string;
}

interface ReadinessStatus {
  services: {
    redis: boolean;
    stealthWorker: boolean;
    ollama: boolean;
    vaultEncryptionEnabled: boolean;
    failureAlertsEnabled: boolean;
    simulationDisabled?: boolean;
  };
  apiCredentials: Record<string, boolean>;
  vaultedProfiles: Array<Record<string, any>>;
}

interface SelectorInspectionReport {
  ok: boolean;
  account_id: string;
  platform_id: string;
  target_url?: string;
  current_url?: string;
  page_title?: string;
  redirected_to_login?: boolean;
  matched_groups?: string[];
  missing_groups?: string[];
  selectors?: Record<string, Array<{ selector: string; count: number; visible: boolean }>>;
  preview_screenshot?: string | null;
  error?: string;
}

interface SelectorRecipeForm {
  upload_url: string;
  url_prefix: string;
  file_input_selectors: string;
  title_selectors: string;
  description_selectors: string;
  tag_selectors: string;
  compliance_selectors: string;
  submit_selectors: string;
}

function joinLines(arr?: string[]): string {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AccountVaultPage() {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState(VAULT_BROWSER_PLATFORMS[0].id);
  const [newAccountId, setNewAccountId] = useState("main_creator");
  const [reauthAlias, setReauthAlias] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [inspectCustomUrl, setInspectCustomUrl] = useState("");
  const [inspectReport, setInspectReport] = useState<SelectorInspectionReport | null>(null);
  const [editorPlatform, setEditorPlatform] = useState<string | null>(null);
  const [selectorForm, setSelectorForm] = useState<SelectorRecipeForm | null>(null);
  const [savingSelectors, setSavingSelectors] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const loadVaultState = async () => {
    try {
      const res = await fetch("/api/credentials/status");
      if (res.ok) {
        const data: ReadinessStatus = await res.json();
        setReadiness(data);
        setProfiles(
          (data.vaultedProfiles || []).map((p: any) => ({
            account_id: p.account_id,
            platform: p.platform || "browser_session",
            platforms: Array.isArray(p.platforms)
              ? p.platforms
              : p.platform
              ? [p.platform]
              : [],
            proxy: p.proxy || null,
            updated_at: p.updated_at ? p.updated_at * 1000 : Date.now(),
            encrypted: Boolean(p.encrypted),
            healthy: true,
            statusText: p.encrypted ? "AES-Encrypted Session Stored" : "Session Stored in Vault",
          })),
        );
      }
    } catch {
      setBanner({ kind: "err", text: "Unable to query backend status endpoint." });
    }
  };

  useEffect(() => {
    void loadVaultState();
  }, []);

  const launchConnectWindow = async (accountAlias: string, platformId: string) => {
    if (!accountAlias.trim()) {
      setBanner({ kind: "err", text: "Provide an Account Alias ID (e.g. main_creator)." });
      return;
    }
    setReauthAlias(accountAlias.trim());
    setBanner({
      kind: "info",
      text: `Launching Chrome window for '${platformId}' as '${accountAlias}'. Sign in, then click "Finish & Save Active Re-Auth" or close Chrome.`,
    });

    try {
      const res = await fetch("/api/vault/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountAlias.trim(),
          platform: platformId,
          headless: false,
          timeout_sec: 180,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Stealth worker failed to launch login browser.");
      }

      if (data.success) {
        setBanner({
          kind: "ok",
          text: `Authenticated '${accountAlias}' (${data.status}, ${data.cookie_count} cookies vaulted to ./profiles/${accountAlias}).`,
        });
      } else {
        setBanner({
          kind: "info",
          text: `Browser closed (${data.status}). Cookies captured: ${data.cookie_count}. Complete login before closing, or use Paste Cookies JSON.`,
        });
      }
      await loadVaultState();
    } catch (err: any) {
      setBanner({
        kind: "err",
        text: `Could not launch Chrome login (${err.message}). Use the "Paste Cookies JSON (Cookie-Editor)" tab above instead, or run \`npm run login -- --account ${accountAlias} --platform ${platformId}\` locally.`,
      });
    } finally {
      setReauthAlias(null);
    }
  };

  const finishReauthNow = async () => {
    if (!reauthAlias) return;
    try {
      await fetch("/api/vault/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: reauthAlias }),
      });
    } catch {}
  };

  const handleVerifyAllHealth = async () => {
    if (profiles.length === 0) return;
    setCheckingHealth(true);
    try {
      const batchRes = await fetch("/api/vault/audit-all", { method: "POST" });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        const auditedList: any[] = Array.isArray(batchData.profiles) ? batchData.profiles : [];
        const byId = new Map(auditedList.map((item) => [item.account_id, item]));
        const updated = profiles.map((prof) => {
          const hit = byId.get(prof.account_id);
          if (!hit) return prof;
          return {
            ...prof,
            healthy: Boolean(hit.healthy),
            proxy: hit.proxy ?? prof.proxy,
            proxy_ok: hit.proxy_ok,
            proxy_latency_ms: hit.proxy_latency_ms,
            cookie_count: hit.valid_cookie_count ?? hit.cookie_count,
            domains: hit.domains,
            statusText: hit.reason || prof.statusText,
          };
        });
        setProfiles(updated);
        const healthyCount = updated.filter((u) => u.healthy).length;
        setBanner({
          kind: healthyCount === updated.length ? "ok" : "info",
          text: `Completed batch cookie & proxy audit: ${healthyCount}/${updated.length} profile(s) healthy.`,
        });
        return;
      }

      const updated = await Promise.all(
        profiles.map(async (prof) => {
          try {
            const res = await fetch("/api/vault/health", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                account_id: prof.account_id,
                platform: prof.platform || "generic",
              }),
            });
            if (res.ok) {
              const data = await res.json();
              return { ...prof, healthy: data.healthy, statusText: data.reason };
            }
          } catch {}
          return { ...prof, healthy: false, statusText: "Stealth worker unreachable" };
        }),
      );
      setProfiles(updated);
      setBanner({ kind: "ok", text: `Completed pre-flight session health check across ${updated.length} profile(s).` });
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleExportBundle = async () => {
    try {
      const res = await fetch("/api/vault/bundle");
      if (!res.ok) throw new Error("Failed to export vault bundle");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `polypost-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBanner({
        kind: "ok",
        text: `Exported portable backup (${data.vault?.profiles?.length ?? 0} account profiles + ${data.presets?.length ?? 0} presets).`,
      });
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message || "Export failed" });
    }
  };

  const handleImportBundleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      const res = await fetch("/api/vault/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setBanner({
        kind: "ok",
        text: `Restored ${data.restoredProfiles} profile(s), ${data.restoredProxies} proxy rule(s), and ${data.restoredPresets} preset(s).`,
      });
      await loadVaultState();
    } catch (err: any) {
      setBanner({ kind: "err", text: `Could not import backup JSON: ${err.message}` });
    } finally {
      e.target.value = "";
    }
  };

  const handleDeleteProfile = async (accountAlias: string) => {
    try {
      const res = await fetch(`/api/vault/profiles/${encodeURIComponent(accountAlias)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove profile");
      setProfiles((prev) => prev.filter((p) => p.account_id !== accountAlias));
      setBanner({ kind: "ok", text: `Deleted vaulted profile '${accountAlias}'.` });
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message });
    }
  };

  const handleCloneToNextAlias = (prof: ProfileItem) => {
    const base = prof.account_id.replace(/_\d+$/, "") || "account";
    const existing = new Set(profiles.map((item) => item.account_id));
    let idx = 2;
    while (existing.has(`${base}_${idx}`)) {
      idx++;
    }
    const nextAlias = `${base}_${idx}`;
    const plat = prof.platform && prof.platform !== "browser_session" ? prof.platform : selectedPlatform;
    setSelectedPlatform(plat);
    setNewAccountId(nextAlias);
    setBanner({
      kind: "info",
      text: `Pre-filled next account alias '${nextAlias}' for '${plat}' in the Connect Browser Session card above. Assign a sticky proxy or click Launch Chrome to sign in!`,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openSelectorEditor = async (platformId: string) => {
    try {
      const res = await fetch(`/api/vault/selectors?platform=${encodeURIComponent(platformId)}`);
      const data = await res.json();
      const base = data.override || data.recipe || {};
      setEditorPlatform(platformId);
      setSelectorForm({
        upload_url: base.upload_url || "",
        url_prefix: base.url_prefix || "",
        file_input_selectors: joinLines(base.file_input_selectors),
        title_selectors: joinLines(base.title_selectors),
        description_selectors: joinLines(base.description_selectors),
        tag_selectors: joinLines(base.tag_selectors),
        compliance_selectors: joinLines(base.compliance_selectors),
        submit_selectors: joinLines(base.submit_selectors),
      });
    } catch (err: any) {
      setBanner({ kind: "err", text: `Could not load selectors: ${err.message}` });
    }
  };

  const handleSaveSelectors = async () => {
    if (!editorPlatform || !selectorForm) return;
    setSavingSelectors(true);
    try {
      const res = await fetch("/api/vault/selectors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: editorPlatform,
          recipe: {
            upload_url: selectorForm.upload_url,
            url_prefix: selectorForm.url_prefix,
            file_input_selectors: splitLines(selectorForm.file_input_selectors),
            title_selectors: splitLines(selectorForm.title_selectors),
            description_selectors: splitLines(selectorForm.description_selectors),
            tag_selectors: splitLines(selectorForm.tag_selectors),
            compliance_selectors: splitLines(selectorForm.compliance_selectors),
            submit_selectors: splitLines(selectorForm.submit_selectors),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save selector override");
      setBanner({
        kind: "ok",
        text: `Saved CSS selector override for '${editorPlatform}' to config/selector-overrides.json.`,
      });
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message });
    } finally {
      setSavingSelectors(false);
    }
  };

  const handleResetSelectors = async () => {
    if (!editorPlatform) return;
    try {
      await fetch(`/api/vault/selectors?platform=${encodeURIComponent(editorPlatform)}`, {
        method: "DELETE",
      });
      await openSelectorEditor(editorPlatform);
      setBanner({
        kind: "ok",
        text: `Removed custom selector overrides for '${editorPlatform}'; built-in recipe restored.`,
      });
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message });
    }
  };

  const handleInspectSelectors = async (accountAlias: string, platformId: string) => {
    setInspectingId(accountAlias);
    setInspectReport(null);
    setBanner({
      kind: "info",
      text: `Running live Playwright selector inspection for '${accountAlias}' on '${platformId}'...`,
    });
    try {
      const res = await fetch("/api/vault/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountAlias,
          platform: platformId,
          custom_url: inspectCustomUrl.trim() || null,
          headless: true,
        }),
      });
      const data: SelectorInspectionReport = await res.json();
      setInspectReport(data);
      void openSelectorEditor(platformId);
      if (!data.ok) {
        setBanner({ kind: "err", text: data.error || "Selector inspection failed." });
      } else if (data.redirected_to_login) {
        setBanner({
          kind: "err",
          text: `Session for '${accountAlias}' redirected to login (${data.current_url}). Click Re-Auth to refresh cookies.`,
        });
      } else {
        setBanner({
          kind: "ok",
          text: `DOM Inspector finished on '${platformId}': matched [${(data.matched_groups || []).join(", ") || "none"}].`,
        });
      }
    } catch (err: any) {
      setBanner({ kind: "err", text: err.message });
    } finally {
      setInspectingId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Interactive Account Login Vault &amp; Credentials</h1>
          <p className="text-sm text-slate-400">
            Connect browser-session platforms via a one-time visible Patchright Chromium window (<code className="text-indigo-300 font-mono">./profiles/&lt;alias&gt;</code>), or configure direct REST API tokens in <code className="text-indigo-300 font-mono">.env</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-800">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-indigo-400 font-bold uppercase tracking-wider text-[10px]">Step 1A: Browser Accounts</span>
            <p className="text-slate-300">
              For Pornhub, Fansly, OnlyFans, X, Instagram, etc.: enter an alias like <code className="font-mono text-indigo-300">main_creator</code> below and click <strong>Launch Connect Window</strong>. Log in manually (with 2FA) in the opened Chrome window; cookies auto-save.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-emerald-400 font-bold uppercase tracking-wider text-[10px]">Step 1B: API / Bot Accounts</span>
            <p className="text-slate-300">
              For Bluesky, Mastodon, Telegram, Discord, Slack, Reddit, e621, DeviantArt, Inkbunny: paste tokens directly into the <strong>Direct API &amp; Bot Accounts</strong> forms below and click <strong>Save &amp; Test Live Connection</strong>. No restarts required!
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-purple-400 font-bold uppercase tracking-wider text-[10px]">Step 2: Turn Off Demo Mode</span>
            <p className="text-slate-300">
              In Composer (<code className="font-mono text-indigo-300">/</code>), stage your media file, pick your alias (<code className="font-mono text-indigo-300">main_creator</code>), check <strong>2257</strong> if adult, and check <strong>Strict Live Only</strong> before clicking Launch.
            </p>
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-4 ${
            banner.kind === "ok"
              ? "bg-emerald-950/70 border-emerald-700 text-emerald-200"
              : banner.kind === "info"
              ? "bg-indigo-950/70 border-indigo-700 text-indigo-200"
              : "bg-red-950/70 border-red-700 text-red-200"
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-[11px] opacity-75 hover:opacity-100 whitespace-nowrap">
            Dismiss
          </button>
        </div>
      )}

      {/* System & API Credentials Live Readiness Grid */}
      {readiness && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Worker Services Readiness</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(readiness.services).map(([key, ok]) => (
                <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-300 font-mono text-[11px]">{key}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                      ok ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {ok ? "READY" : "OFF"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Direct .env API Credentials</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(readiness.apiCredentials).map(([key, configured]) => (
                <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-300 font-mono text-[11px]">{key}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                      configured ? "bg-emerald-950 text-emerald-300" : "bg-amber-950/60 text-amber-300"
                    }`}
                  >
                    {configured ? "LIVE KEY" : "UNSET"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Connect Account Action Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Connect Browser Session (Chrome Login or Cookie-Editor JSON)</h2>
          {reauthAlias && (
            <button
              type="button"
              onClick={() => void finishReauthNow()}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
            >
              Finish &amp; Save Active Re-Auth ({reauthAlias})
            </button>
          )}
        </div>
        <BrowserSessionConnector
          initialPlatformId={selectedPlatform}
          initialAlias={newAccountId}
          vaultAliases={profiles.map((p) => p.account_id)}
          showConnectedAliases={false}
          onPlatformChange={setSelectedPlatform}
          onAliasChange={setNewAccountId}
          onConnected={() => void loadVaultState()}
        />
      </div>

      {/* Connected Profiles List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Vaulted Account Profiles ({profiles.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportBundle()}
              className="text-xs px-2.5 py-1.5 rounded bg-slate-950 hover:bg-slate-800 text-indigo-300 border border-slate-700 font-medium cursor-pointer"
            >
              Export Backup (.json)
            </button>
            <label className="text-xs px-2.5 py-1.5 rounded bg-slate-950 hover:bg-slate-800 text-emerald-300 border border-slate-700 font-medium cursor-pointer">
              Import Backup (.json)
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleImportBundleFile}
                className="hidden"
              />
            </label>
            <button
              onClick={handleVerifyAllHealth}
              disabled={checkingHealth || profiles.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium disabled:opacity-50 cursor-pointer"
            >
              {checkingHealth ? "Checking..." : "Pre-Flight Verify All Sessions"}
            </button>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="p-6 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 text-center space-y-2">
            <p className="text-slate-300 font-medium">No browser session profiles vaulted in ./profiles yet.</p>
            <p>Connect an account above or run the CLI helper to authenticate your real accounts cleanly.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <div
                key={p.account_id}
                className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white text-sm">{p.account_id}</span>
                    {(p.platforms && p.platforms.length > 0 ? p.platforms : [p.platform]).map((plat) => (
                      <span
                        key={plat}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]"
                      >
                        {plat}
                      </span>
                    ))}
                    <span
                      className={`px-2 py-0.5 rounded font-medium text-[10px] ${
                        p.healthy
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : "bg-red-950 text-red-300 border border-red-800"
                      }`}
                    >
                      {p.healthy ? "HEALTHY" : "EXPIRED"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                        p.proxy
                          ? p.proxy_ok === false
                            ? "bg-red-950 text-red-300 border border-red-700"
                            : "bg-indigo-950 text-indigo-300 border border-indigo-700"
                          : "bg-slate-900 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {p.proxy
                        ? `PROXY: ${p.proxy}${p.proxy_latency_ms != null ? ` (${p.proxy_latency_ms}ms)` : ""}`
                        : "DIRECT IP"}
                    </span>
                    {typeof p.cookie_count === "number" && (
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 font-mono text-[10px]">
                        {p.cookie_count} cookies
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400">{p.statusText || "Active"}</p>
                </div>

                <div className="flex items-center space-x-2 text-slate-400">
                  <span className="font-mono text-[11px]">
                    Updated: {new Date(p.updated_at || Date.now()).toLocaleTimeString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCloneToNextAlias(p)}
                    className="px-2.5 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/70 cursor-pointer"
                    title="Pre-fill the next numbered account alias (#2, #3...) for fast multi-account onboarding"
                  >
                    + Next Alias
                  </button>
                  <button
                    onClick={() => void handleInspectSelectors(p.account_id, p.platform || selectedPlatform)}
                    disabled={inspectingId === p.account_id}
                    className="px-2.5 py-1 rounded bg-indigo-900/70 hover:bg-indigo-800 text-indigo-200 cursor-pointer disabled:opacity-50"
                  >
                    {inspectingId === p.account_id ? "Inspecting..." : "Inspect DOM"}
                  </button>
                  <button
                    onClick={() => launchConnectWindow(p.account_id, p.platform || selectedPlatform)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white"
                  >
                    Re-Auth
                  </button>
                  <button
                    onClick={() => handleDeleteProfile(p.account_id)}
                    className="px-2.5 py-1 rounded bg-slate-900 hover:bg-red-950 text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-slate-400">
              Optional Custom Target URL Override for DOM Selector Inspector:
            </label>
            <button
              type="button"
              onClick={() => void openSelectorEditor(selectedPlatform)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-medium cursor-pointer"
            >
              Edit Selector Recipe ({selectedPlatform})
            </button>
          </div>
          <input
            type="text"
            value={inspectCustomUrl}
            onChange={(e) => setInspectCustomUrl(e.target.value)}
            placeholder="Leave empty to use built-in platform upload URL from recipe"
            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white font-mono"
          />
        </div>

        {inspectReport && (
          <div className="p-4 rounded-lg bg-slate-950 border border-indigo-800/70 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-indigo-300">
                Selector Recipe Inspection: {inspectReport.platform_id} ({inspectReport.account_id})
              </span>
              <span className="font-mono text-[11px] text-slate-400 truncate max-w-md">
                {inspectReport.current_url || inspectReport.target_url}
              </span>
            </div>
            {inspectReport.error ? (
              <p className="text-red-300 font-mono">{inspectReport.error}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {Object.entries(inspectReport.selectors || {}).map(([group, list]) => (
                    <div key={group} className="p-2 rounded bg-slate-900 border border-slate-800 space-y-1">
                      <span className="font-mono uppercase text-[10px] text-slate-300 font-bold block">{group}</span>
                      {list.map((entry) => (
                        <div key={entry.selector} className="flex items-center justify-between font-mono text-[10px]">
                          <span className="text-slate-400 truncate mr-2">{entry.selector}</span>
                          <span className={entry.count > 0 ? "text-emerald-400" : "text-slate-600"}>
                            {entry.count > 0 ? `FOUND (${entry.count})` : "MISS"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {inspectReport.preview_screenshot && (
                  <div className="space-y-1">
                    <span className="text-slate-400 font-mono text-[11px] block">Rendered Page Preview:</span>
                    <img
                      src={`/api/vault/preview/${encodeURIComponent(inspectReport.preview_screenshot)}`}
                      alt="DOM Inspector preview screenshot"
                      className="w-full rounded border border-slate-800 bg-black"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {editorPlatform && selectorForm && (
          <div className="p-4 rounded-lg bg-slate-950 border border-emerald-800/60 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-emerald-300">
                  Selector Override Editor: {editorPlatform}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Saved to <code className="font-mono text-indigo-300">config/selector-overrides.json</code> (one CSS selector per line; overrides built-in Python uploader selectors).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleResetSelectors()}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorPlatform(null);
                    setSelectorForm(null);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">Upload Page URL:</label>
                <input
                  type="text"
                  value={selectorForm.upload_url}
                  onChange={(e) => setSelectorForm({ ...selectorForm, upload_url: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Published URL Prefix:</label>
                <input
                  type="text"
                  value={selectorForm.url_prefix}
                  onChange={(e) => setSelectorForm({ ...selectorForm, url_prefix: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">File Input Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.file_input_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, file_input_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Title Input Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.title_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, title_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Description Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.description_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, description_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Tag Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.tag_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, tag_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">2257 Compliance Checkbox Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.compliance_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, compliance_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Submit / Publish Button Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.submit_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, submit_selectors: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveSelectors()}
              disabled={savingSelectors}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingSelectors ? "Saving..." : "Save Selector Overrides"}
            </button>
          </div>
        )}
      </div>

      {/* REST API & Token Accounts Configuration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Direct API, Bot &amp; Webhook Accounts</h2>
          <p className="text-sm text-slate-400">
            Enter your keys directly here—PolyPost saves them safely to <code className="text-indigo-300 font-mono">.env</code> and activates them immediately for live publishing (you can also verify live logins right away).
          </p>
        </div>

        <ApiCredentialsManager onChanged={() => void loadVaultState()} />

        <details className="text-xs text-slate-400 pt-2 border-t border-slate-800">
          <summary className="cursor-pointer hover:text-slate-200 font-medium">
            Advanced: Raw CLI Browser Login Command &amp; .env Reference
          </summary>
          <div className="mt-3 p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 space-y-1 overflow-x-auto">
            <p className="text-slate-500"># Terminal CLI Interactive Login</p>
            <p className="text-emerald-400">
              npm run login -- --account {newAccountId || "main_creator"} --platform {selectedPlatform}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

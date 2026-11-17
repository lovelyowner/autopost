"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ApiCredentialsManager,
  BrowserSessionConnector,
  VAULT_BROWSER_PLATFORMS,
} from "../../components/AccountConnectModal";
import { LetterFilterBar, matchesSearchAndLetter } from "../../components/LetterFilterBar";
import { OneClickConnectPanel } from "../../components/OneClickConnectPanel";
import {
  PLATFORM_SAFETY_CAPS,
  detectMultiAccountProxyCollisions,
} from "@/lib/account-safety";
import { getClientCredentials, getSavedCompanionUrl } from "@/lib/client-vault";
import {
  COMPANION_CHANGED_EVENT,
  CREDENTIALS_CHANGED_EVENT,
  detectActiveCompanion,
  vaultApiFetch,
} from "@/lib/companion-bridge";
import { buildClientApiFlags } from "@/lib/credential-mapping";

interface ProfileItem {
  account_id: string;
  platform?: string;
  platforms?: string[];
  proxy?: string | null;
  proxy_ok?: boolean;
  proxy_latency_ms?: number | null;
  cookie_count?: number;
  origin_count?: number;
  posts_last_24h?: number;
  domains?: string[];
  updated_at?: number;
  encrypted?: boolean;
  healthy?: boolean;
  statusText?: string;
}

interface ReadinessStatus {
  cloudMode?: boolean;
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
  const [focusApiProvider, setFocusApiProvider] = useState<string | null>(null);
  const [capSearch, setCapSearch] = useState("");
  const [capLetter, setCapLetter] = useState("all");
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const proxyCollisions = useMemo(() => detectMultiAccountProxyCollisions(profiles), [profiles]);
  const availableCapLetters = useMemo(
    () => new Set(PLATFORM_SAFETY_CAPS.map((c) => c.name.trim().charAt(0).toUpperCase()).filter(Boolean)),
    [],
  );
  const filteredSafetyCaps = useMemo(
    () =>
      PLATFORM_SAFETY_CAPS.filter((c) =>
        matchesSearchAndLetter(c.name, c.id, capSearch, capLetter, `${c.connectionAdvice} ${c.notes}`),
      ),
    [capSearch, capLetter],
  );

  const loadVaultState = async () => {
    try {
      const [res, companion] = await Promise.all([
        fetch("/api/credentials/status"),
        detectActiveCompanion(),
      ]);
      if (res.ok) {
        const data: ReadinessStatus = await res.json();
        const mergedApiCreds = buildClientApiFlags(
          getClientCredentials(),
          data.apiCredentials || {},
        );
        const rawProfiles = companion ? companion.profiles : data.vaultedProfiles || [];
        setReadiness({
          ...data,
          services: {
            ...data.services,
            stealthWorker: Boolean(data.services?.stealthWorker || companion),
          },
          apiCredentials: mergedApiCreds,
          vaultedProfiles: rawProfiles,
        });
        setProfiles(
          rawProfiles.map((p: any) => ({
            account_id: p.account_id,
            platform: p.platform || "browser_session",
            platforms: Array.isArray(p.platforms)
              ? p.platforms
              : p.platform
              ? [p.platform]
              : [],
            proxy: p.proxy || null,
            cookie_count: p.cookie_count,
            origin_count: p.origin_count,
            posts_last_24h: p.posts_last_24h,
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
    const onRefresh = () => void loadVaultState();
    window.addEventListener(COMPANION_CHANGED_EVENT, onRefresh);
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(COMPANION_CHANGED_EVENT, onRefresh);
      window.removeEventListener(CREDENTIALS_CHANGED_EVENT, onRefresh);
    };
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
      const res = await vaultApiFetch("/api/vault/login", {
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
        throw new Error(data.detail || data.error || "Stealth worker failed to launch login browser.");
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
      await vaultApiFetch("/api/vault/login/complete", {
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
      const batchRes = await vaultApiFetch("/api/vault/audit-all", { method: "POST" });
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
            origin_count: hit.origin_count ?? prof.origin_count,
            posts_last_24h: hit.posts_last_24h ?? prof.posts_last_24h,
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
            const res = await vaultApiFetch("/api/vault/health", {
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
      const res = await vaultApiFetch("/api/vault/bundle");
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
        text: `Exported portable backup (${data.vault?.profiles?.length ?? data.profiles?.length ?? 0} account profiles + ${data.presets?.length ?? 0} presets).`,
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
      const res = await vaultApiFetch("/api/vault/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || "Import failed");
      setBanner({
        kind: "ok",
        text: `Restored ${data.restoredProfiles ?? data.restored ?? 0} profile(s), ${data.restoredProxies ?? 0} proxy rule(s), and ${data.restoredPresets ?? 0} preset(s).`,
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
      const res = await vaultApiFetch(`/api/vault/profiles/${encodeURIComponent(accountAlias)}`, {
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
      const res = await vaultApiFetch(`/api/vault/selectors?platform=${encodeURIComponent(platformId)}`);
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
      const res = await vaultApiFetch("/api/vault/inspect", {
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
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[#333333] mb-2">Interactive Account Login Vault &amp; Credentials</h1>
          <p className="text-sm text-[#999999]">
            Connect browser-session platforms via a one-time visible Patchright Chromium window (<code className="text-[#333333] font-mono">./profiles/&lt;alias&gt;</code>), or configure direct REST API tokens in <code className="text-[#333333] font-mono">.env</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-2">
          <div className="p-3 rounded-lg bg-white space-y-1">
            <span className="text-[#333333] font-bold uppercase tracking-wider text-[10px]">Step 1A: Browser Accounts</span>
            <p className="text-[#666666]">
              For Pornhub, Fansly, OnlyFans, X, Instagram, etc.: enter an alias like <code className="font-mono text-[#333333]">main_creator</code> below and click <strong>Launch Connect Window</strong>. Log in manually (with 2FA) in the opened Chrome window; cookies auto-save.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white space-y-1">
            <span className="text-[#333333] font-bold uppercase tracking-wider text-[10px]">Step 1B: API / Bot Accounts</span>
            <p className="text-[#666666]">
              For Bluesky, Mastodon, Telegram, Discord, Slack, Reddit, e621, DeviantArt, Inkbunny: paste tokens directly into the <strong>Direct API &amp; Bot Accounts</strong> forms below and click <strong>Save &amp; Test Live Connection</strong>. No restarts required!
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white space-y-1">
            <span className="text-[#333333] font-bold uppercase tracking-wider text-[10px]">Step 2: Launch Live Campaign</span>
            <p className="text-[#666666]">
              In Composer (<code className="font-mono text-[#333333]">/</code>), stage media, match your Vault alias (<code className="font-mono text-[#333333]">main_creator</code>), and enable <strong>Strict Live Only</strong> before clicking Launch.
            </p>
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between gap-4 ${ banner.kind === "ok" ? "bg-white text-[#333333]" : banner.kind === "info" ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-[11px] opacity-75 hover:opacity-100 whitespace-nowrap border border-[#cccccc] rounded bg-white hover:font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* System Worker Readiness Strip */}
      {readiness && (
        <div className="bg-white rounded-xl p-4 space-y-2.5">
          <h2 className="text-xs font-semibold text-[#333333] uppercase tracking-wider">Worker Services Readiness</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {Object.entries(readiness.services).map(([key, ok]) => (
              <div key={key} className="flex items-center justify-between p-2 rounded bg-white">
                <span className="text-[#666666] font-mono text-[10px] truncate mr-1">{key}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${ ok ? "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                >
                  {ok ? "READY" : "OFF"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <OneClickConnectPanel
        apiFlags={readiness?.apiCredentials}
        cloudMode={Boolean(readiness?.cloudMode)}
        onConnected={() => {
          void loadVaultState();
        }}
        onSelectProvider={(providerId) => {
          setFocusApiProvider(providerId);
          document.getElementById("api-credentials-section")?.scrollIntoView({ behavior: "smooth" });
        }}
        onOpenBrowserLogin={(platformId) => {
          setSelectedPlatform(platformId);
          void launchConnectWindow(newAccountId || "main_creator", platformId);
        }}
      />

      {/* Connect Account Action Card */}
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[#333333]">Connect Browser Session (Chrome Login or Cookie-Editor JSON)</h2>
          {reauthAlias && (
            <button
              type="button"
              onClick={() => void finishReauthNow()}
              className="border px-3 py-1.5 rounded bg-white text-[#333333] text-xs font-bold cursor-pointer border-[#cccccc] hover:font-bold"
            >
              Finish &amp; Save Active Re-Auth ({reauthAlias})
            </button>
          )}
        </div>
        <BrowserSessionConnector
          initialPlatformId={selectedPlatform}
          initialAlias={newAccountId}
          vaultAliases={profiles.map((p) => p.account_id)}
          stealthOnline={readiness ? readiness.services.stealthWorker : undefined}
          showConnectedAliases={false}
          onPlatformChange={setSelectedPlatform}
          onAliasChange={setNewAccountId}
          onConnected={() => void loadVaultState()}
        />
      </div>

      {/* Connected Profiles List */}
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[#333333]">Vaulted Account Profiles ({profiles.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportBundle()}
              className="text-xs px-2.5 py-1.5 rounded bg-white text-[#333333] border font-medium cursor-pointer border-[#cccccc] hover:font-bold"
            >
              Export Backup (.json)
            </button>
            <label className="text-xs px-2.5 py-1.5 rounded bg-white text-[#333333] border font-medium cursor-pointer border-[#cccccc]">
              Import Backup (.json)
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleImportBundleFile}
                className="hidden border-0 border-b border-[#cccccc] rounded-none bg-white"
              />
            </label>
            <button
              onClick={handleVerifyAllHealth}
              disabled={checkingHealth || profiles.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-white text-[#333333] border font-medium disabled:opacity-50 cursor-pointer border-[#cccccc] hover:font-bold"
            >
              {checkingHealth ? "Checking..." : "Pre-Flight Verify All Sessions"}
            </button>
          </div>
        </div>

        {proxyCollisions.length > 0 && (
          <div className="p-3.5 rounded-lg bg-white space-y-1.5 text-xs">
            <div className="font-semibold text-[#333333]">
              Multi-Account IP / Proxy Overlap Warning ({proxyCollisions.length})
            </div>
            <ul className="list-disc list-inside space-y-1 text-[#666666]">
              {proxyCollisions.map((w) => (
                <li key={`${w.platform}-${w.endpointLabel}`}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="p-6 rounded-lg bg-white text-xs text-[#999999] text-center space-y-2">
            <p className="text-[#666666] font-medium">No browser session profiles vaulted in ./profiles yet.</p>
            <p>Connect an account above or run the CLI helper to authenticate your real accounts cleanly.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <div
                key={p.account_id}
                className="p-4 rounded-lg bg-white flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-[#333333] text-sm">{p.account_id}</span>
                    {(p.platforms && p.platforms.length > 0 ? p.platforms : [p.platform]).map((plat) => (
                      <span
                        key={plat}
                        className="px-2 py-0.5 rounded bg-white text-[#666666] font-mono text-[11px]"
                      >
                        {plat}
                      </span>
                    ))}
                    <span
                      className={`px-2 py-0.5 rounded font-medium text-[10px] ${ p.healthy ? "bg-white text-[#333333]" : "bg-white text-[#333333]" }`}
                    >
                      {p.healthy ? "HEALTHY" : "EXPIRED"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] ${ p.proxy ? p.proxy_ok === false ? "bg-white text-[#333333]" : "bg-white text-[#333333]" : "bg-white text-[#999999]" }`}
                    >
                      {p.proxy
                        ? `PROXY: ${p.proxy}${p.proxy_latency_ms != null ? ` (${p.proxy_latency_ms}ms)` : ""}`
                        : "DIRECT IP"}
                    </span>
                    {typeof p.cookie_count === "number" && (
                      <span className="px-2 py-0.5 rounded bg-white text-[#666666] font-mono text-[10px]">
                        {p.cookie_count} cookies
                      </span>
                    )}
                    {typeof p.origin_count === "number" && p.origin_count > 0 && (
                      <span className="px-2 py-0.5 rounded bg-white text-[#666666] font-mono text-[10px]">
                        {p.origin_count} SPA origins
                      </span>
                    )}
                    {typeof p.posts_last_24h === "number" && (
                      <span className="px-2 py-0.5 rounded bg-white text-[#666666] font-mono text-[10px]">
                        {p.posts_last_24h} posts/24h
                      </span>
                    )}
                  </div>
                  <p className="text-[#999999]">{p.statusText || "Active"}</p>
                </div>

                <div className="flex items-center space-x-2 text-[#999999]">
                  <span className="font-mono text-[11px]">
                    Updated: {new Date(p.updated_at || Date.now()).toLocaleTimeString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCloneToNextAlias(p)}
                    className="px-2.5 py-1 rounded bg-white text-[#333333] border cursor-pointer border-[#cccccc] hover:font-bold"
                    title="Pre-fill the next numbered account alias (#2, #3...) for fast multi-account onboarding"
                  >
                    + Next Alias
                  </button>
                  <button
                    onClick={() => void handleInspectSelectors(p.account_id, p.platform || selectedPlatform)}
                    disabled={inspectingId === p.account_id}
                    className="border px-2.5 py-1 rounded bg-white text-[#333333] cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
                  >
                    {inspectingId === p.account_id ? "Inspecting..." : "Inspect DOM"}
                  </button>
                  <button
                    onClick={() => launchConnectWindow(p.account_id, p.platform || selectedPlatform)}
                    className="border px-2.5 py-1 rounded bg-white text-[#333333] border-[#cccccc] hover:font-bold"
                  >
                    Re-Auth
                  </button>
                  <button
                    onClick={() => handleDeleteProfile(p.account_id)}
                    className="border px-2.5 py-1 rounded bg-white text-[#333333] border-[#cccccc] hover:font-bold"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[#999999]">
              Optional Custom Target URL Override for DOM Selector Inspector:
            </label>
            <button
              type="button"
              onClick={() => void openSelectorEditor(selectedPlatform)}
              className="border px-2.5 py-1 rounded bg-white text-[#333333] font-medium cursor-pointer border-[#cccccc] hover:font-bold"
            >
              Edit Selector Recipe ({selectedPlatform})
            </button>
          </div>
          <input
            type="text"
            value={inspectCustomUrl}
            onChange={(e) => setInspectCustomUrl(e.target.value)}
            placeholder="Leave empty to use built-in platform upload URL from recipe"
            className="w-full bg-white px-3 py-1.5 text-xs text-[#333333] font-mono border-0 border-b border-[#cccccc] rounded-none"
          />
        </div>

        {inspectReport && (
          <div className="p-4 rounded-lg bg-white space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#333333]">
                Selector Recipe Inspection: {inspectReport.platform_id} ({inspectReport.account_id})
              </span>
              <span className="font-mono text-[11px] text-[#999999] truncate max-w-md">
                {inspectReport.current_url || inspectReport.target_url}
              </span>
            </div>
            {inspectReport.error ? (
              <p className="text-[#333333] font-mono">{inspectReport.error}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {Object.entries(inspectReport.selectors || {}).map(([group, list]) => (
                    <div key={group} className="p-2 rounded bg-white space-y-1">
                      <span className="font-mono uppercase text-[10px] text-[#666666] font-bold block">{group}</span>
                      {list.map((entry) => (
                        <div key={entry.selector} className="flex items-center justify-between font-mono text-[10px]">
                          <span className="text-[#999999] truncate mr-2">{entry.selector}</span>
                          <span className={entry.count > 0 ? "text-[#333333] font-semibold" : "text-[#999999]"}>
                            {entry.count > 0 ? `FOUND (${entry.count})` : "MISS"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {inspectReport.preview_screenshot && (
                  <div className="space-y-1">
                    <span className="text-[#999999] font-mono text-[11px] block">Rendered Page Preview:</span>
                    <img
                      src={
                        getSavedCompanionUrl()
                          ? `${getSavedCompanionUrl()}/api/previews/${encodeURIComponent(inspectReport.preview_screenshot)}`
                          : `/api/vault/preview/${encodeURIComponent(inspectReport.preview_screenshot)}`
                      }
                      alt="DOM Inspector preview screenshot"
                      className="w-full rounded bg-white"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {editorPlatform && selectorForm && (
          <div className="p-4 rounded-lg bg-white space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-[#333333]">
                  Selector Override Editor: {editorPlatform}
                </h3>
                <p className="text-[11px] text-[#999999]">
                  Saved to <code className="font-mono text-[#333333]">config/selector-overrides.json</code> (one CSS selector per line; overrides built-in Python uploader selectors).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleResetSelectors()}
                  className="border px-2.5 py-1 rounded bg-white text-[#666666] cursor-pointer border-[#cccccc] hover:font-bold"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorPlatform(null);
                    setSelectorForm(null);
                  }}
                  className="border px-2.5 py-1 rounded bg-white text-[#999999] cursor-pointer border-[#cccccc] hover:font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[#999999] block mb-1">Upload Page URL:</label>
                <input
                  type="text"
                  value={selectorForm.upload_url}
                  onChange={(e) => setSelectorForm({ ...selectorForm, upload_url: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Published URL Prefix:</label>
                <input
                  type="text"
                  value={selectorForm.url_prefix}
                  onChange={(e) => setSelectorForm({ ...selectorForm, url_prefix: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">File Input Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.file_input_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, file_input_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Title Input Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.title_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, title_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Description Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.description_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, description_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Tag Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.tag_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, tag_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">2257 Compliance Checkbox Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.compliance_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, compliance_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
              <div>
                <label className="text-[#999999] block mb-1">Submit / Publish Button Selectors:</label>
                <textarea
                  rows={2}
                  value={selectorForm.submit_selectors}
                  onChange={(e) => setSelectorForm({ ...selectorForm, submit_selectors: e.target.value })}
                  className="w-full bg-white px-2.5 py-1.5 font-mono text-[#333333] border-0 border-b border-[#cccccc] rounded-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveSelectors()}
              disabled={savingSelectors}
              className="border px-4 py-2 rounded bg-white text-[#333333] font-semibold cursor-pointer disabled:opacity-50 border-[#cccccc] hover:font-bold"
            >
              {savingSelectors ? "Saving..." : "Save Selector Overrides"}
            </button>
          </div>
        )}
      </div>

      {/* Multi-Account Anti-Ban Caps & Proxy Reference */}
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[#333333]">Multi-Account Anti-Ban Limits &amp; Proxy vs Wi-Fi Guide</h2>
          <p className="text-xs text-[#666666] leading-relaxed">
            Running 1–3+ accounts safely: prefer <strong>Official API / OAuth / Webhooks</strong> first. For browser sessions, keep 1–2 accounts max per clean Home/Mobile IP, use <strong>1 Sticky Residential Proxy per extra alias</strong> (avoid rotating datacenter VPNs), and space autoposts with human jitter.
          </p>
        </div>

        <LetterFilterBar
          searchQuery={capSearch}
          onSearchChange={setCapSearch}
          selectedLetter={capLetter}
          onLetterChange={setCapLetter}
          availableLetters={availableCapLetters}
          searchPlaceholder="Filter safety rules: x, instagram, discord, fluxer, stoat, matrix, bluesky, mastodon, nostr, pinterest..."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
          {filteredSafetyCaps.length === 0 ? (
            <div className="col-span-full p-3 rounded-lg bg-white text-[#666666]">
              No safety guide entries match &ldquo;{capSearch || capLetter}&rdquo;.
            </div>
          ) : (
            filteredSafetyCaps.map((cap) => (
              <div key={cap.id} className="p-3 rounded-lg bg-white space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#333333]">{cap.name}</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white text-[#333333]">
                    {cap.safeAccountsPerIp} / IP
                  </span>
                </div>
                <div className="text-[11px] text-[#666666]">
                  <strong>Daily Cap:</strong> {cap.maxPostsPerDayPerAccount} · <strong>Min Gap:</strong> &gt;= {cap.minGapMinutes}m
                </div>
                <div className="text-[11px] text-[#666666]">
                  <strong>Network:</strong> {cap.connectionAdvice}
                </div>
                <p className="text-[10px] text-[#999999] leading-snug">{cap.notes}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* REST API & Token Accounts Configuration Card */}
      <div id="api-credentials-section" className="bg-white rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[#333333]">Direct API, Bot &amp; Webhook Accounts</h2>
          <p className="text-sm text-[#999999]">
            Enter your keys directly here—PolyPost saves them safely to <code className="text-[#333333] font-mono">.env</code> and activates them immediately for live publishing (you can also verify live logins right away).
          </p>
        </div>

        <ApiCredentialsManager focusProviderId={focusApiProvider} onChanged={() => void loadVaultState()} />

        <details className="text-xs text-[#999999] pt-2">
          <summary className="cursor-pointer hover:text-[#333333] font-medium">
            Advanced: Raw CLI Browser Login Command &amp; .env Reference
          </summary>
          <div className="mt-3 p-4 rounded-lg bg-white font-mono text-xs text-[#666666] space-y-1 overflow-x-auto">
            <p className="text-[#999999]"># Terminal CLI Interactive Login</p>
            <p className="text-[#333333]">
              npm run login -- --account {newAccountId || "main_creator"} --platform {selectedPlatform}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

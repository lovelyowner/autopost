"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { getClientCredentials, getSavedCompanionUrl, saveClientCredentials } from "@/lib/client-vault";
import { notifyCredentialsChanged } from "@/lib/companion-bridge";
import { LetterFilterBar, matchesSearchAndLetter } from "./LetterFilterBar";

interface OneClickConnectPanelProps {
  apiFlags?: Record<string, boolean>;
  cloudMode?: boolean;
  compact?: boolean;
  onConnected?: (credentials: Record<string, string>, providerId: string) => void | Promise<void>;
  onSelectProvider?: (providerId: string) => void;
  onOpenBrowserLogin?: (platformId: string) => void;
}

interface QuickProviderMeta {
  id: string;
  label: string;
  flagKey: string;
  subtitle: string;
  tier: "primary" | "more";
}

const QUICK_PROVIDERS: QuickProviderMeta[] = [
  { id: "google", label: "Google", flagKey: "google", subtitle: "YouTube & OAuth2", tier: "primary" },
  { id: "discord", label: "Discord", flagKey: "discord", subtitle: "OAuth or Webhook", tier: "primary" },
  { id: "fluxer", label: "Fluxer", flagKey: "fluxer", subtitle: "1-Step Webhook", tier: "primary" },
  { id: "stoat", label: "Stoat", flagKey: "stoat", subtitle: "Email Sign-In / Bot", tier: "primary" },
  { id: "bluesky", label: "Bluesky", flagKey: "bluesky", subtitle: "Handle + App Pass", tier: "primary" },
  { id: "x", label: "Twitter (X)", flagKey: "x", subtitle: "OAuth2 / Chrome", tier: "primary" },
  { id: "nostr", label: "Nostr", flagKey: "nostr", subtitle: "Instant 1-Click Key", tier: "primary" },
  { id: "mastodon", label: "Mastodon", flagKey: "mastodon", subtitle: "Zero-Config OAuth", tier: "primary" },
  { id: "misskey", label: "Misskey", flagKey: "misskey", subtitle: "MiAuth 1-Click", tier: "more" },
  { id: "matrix", label: "Matrix", flagKey: "matrix", subtitle: "Login / Token", tier: "more" },
  { id: "pinterest", label: "Pinterest", flagKey: "pinterest", subtitle: "Chrome Login", tier: "more" },
  { id: "telegram", label: "Telegram", flagKey: "telegram", subtitle: "@BotFather + Channel", tier: "more" },
  { id: "slack", label: "Slack", flagKey: "slack", subtitle: "Incoming Webhook", tier: "more" },
  { id: "devto", label: "Dev.to", flagKey: "devto", subtitle: "API Key", tier: "more" },
  { id: "reddit", label: "Reddit", flagKey: "reddit", subtitle: "OAuth / Chrome", tier: "more" },
  { id: "farcaster", label: "Farcaster", flagKey: "farcaster", subtitle: "Neynar Signer", tier: "more" },
  { id: "wordpress", label: "WordPress", flagKey: "wordpress", subtitle: "App Password", tier: "more" },
];

const OAUTH_SESSION_STORAGE_KEY = "polypost_oauth_session_v1";

function BrandIcon({ id }: { id: string }) {
  const cls = "h-4 w-4 shrink-0 text-[#999999]";
  switch (id) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M21 12.2c0-.7-.1-1.3-.2-2H12v3.9h5.1c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 2.7-4.3 2.7-7.4Z" />
          <path d="M12 21c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6C4.8 18.8 8.1 21 12 21Z" />
          <path d="M6.4 12.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V6.5H3.1C2.4 7.9 2 9.4 2 11s.4 3.1 1.1 4.5l3.3-2.6Z" />
          <path d="M12 5c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 2.1 14.7 1.2 12 1.2 8.1 1.2 4.8 3.4 3.1 6.5l3.3 2.6C7.2 6.7 9.4 5 12 5Z" />
        </svg>
      );
    case "discord":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M8.5 6.5C10.8 6 13.2 6 15.5 6.5l1.2-1.5c1.7.6 3.1 1.7 3.8 3.3.9 2.2 1.3 5 .8 8.4-1.5 1.1-3.1 1.8-4.8 2.2l-.9-1.4c-.9.3-1.7.5-2.6.5h-2c-.9 0-1.7-.2-2.6-.5l-.9 1.4c-1.7-.4-3.3-1.1-4.8-2.2-.5-3.4-.1-6.2.8-8.4C4.2 6.7 5.6 5.6 7.3 5l1.2 1.5Z" />
          <circle cx="9.2" cy="12" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="14.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "fluxer":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" strokeLinejoin="round" />
        </svg>
      );
    case "stoat":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M6 5h8a5 5 0 0 1 0 10H6V5Z" />
          <path d="M6 5v14M13 15l5 4" strokeLinecap="round" />
        </svg>
      );
    case "bluesky":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M12 11.2C9.7 6.8 5.2 4.3 3.7 5.5c-1.5 1.2-.8 6.4 1.3 8.1 1.4 1.1 3.7 1.3 5 .8-2.1.6-4.1 2-3.4 4.1.7 2.2 4.1 1.8 5.4-.5 1.3 2.3 4.7 2.7 5.4.5.7-2.1-1.3-3.5-3.4-4.1 1.3.5 3.6.3 5-.8 2.1-1.7 2.8-6.9 1.3-8.1-1.5-1.2-6 1.3-8.3 5.7Z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <path d="M4 4l16 16M20 4 4 20" strokeLinecap="round" />
        </svg>
      );
    case "nostr":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 16V8l7 8V8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "mastodon":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cls} aria-hidden="true">
          <rect x="4" y="4" width="16" height="14" rx="5" />
          <path d="M8 14v-3.5a2 2 0 0 1 4 0V14m0-3.5a2 2 0 0 1 4 0V14" strokeLinecap="round" />
          <path d="M8 18c1.2 1.8 3.6 2.3 7 1.7" strokeLinecap="round" />
        </svg>
      );
    default:
      return <KeyRound className={cls} />;
  }
}

export function OneClickConnectPanel({
  apiFlags = {},
  cloudMode = false,
  compact = false,
  onConnected,
  onSelectProvider,
  onOpenBrowserLogin,
}: OneClickConnectPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(!compact);
  const [providerSearch, setProviderSearch] = useState("");
  const [letterFilter, setLetterFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [oauthReady, setOauthReady] = useState<Record<string, boolean>>({
    nostr: true,
    mastodon: true,
    misskey: true,
    stoat: true,
    matrix: true,
    bluesky: true,
    fluxer: true,
  });
  const [clientCreds, setClientCreds] = useState<Record<string, string>>({});
  const [companionReachable, setCompanionReachable] = useState(false);

  // Per-provider inline inputs
  const [mastodonHost, setMastodonHost] = useState("mastodon.social");
  const [misskeyHost, setMisskeyHost] = useState("misskey.io");

  const [googleClientId, setGoogleClientId] = useState("");
  const [googleAccessToken, setGoogleAccessToken] = useState("");

  const [discordWebhook, setDiscordWebhook] = useState("");
  const [discordClientId, setDiscordClientId] = useState("");
  const [discordClientSecret, setDiscordClientSecret] = useState("");

  const [fluxerWebhook, setFluxerWebhook] = useState("");

  const [stoatApiUrl, setStoatApiUrl] = useState("https://api.stoat.chat");
  const [stoatEmail, setStoatEmail] = useState("");
  const [stoatPassword, setStoatPassword] = useState("");
  const [stoatChannelId, setStoatChannelId] = useState("");
  const [stoatChannels, setStoatChannels] = useState<Array<{ id: string; label: string }>>([]);

  const [matrixHomeserver, setMatrixHomeserver] = useState("https://matrix-client.matrix.org");
  const [matrixUsername, setMatrixUsername] = useState("");
  const [matrixPassword, setMatrixPassword] = useState("");
  const [matrixRoomId, setMatrixRoomId] = useState("");
  const [matrixRooms, setMatrixRooms] = useState<string[]>([]);
  const [matrixTokenInput, setMatrixTokenInput] = useState("");

  const [bskyIdentifier, setBskyIdentifier] = useState("");
  const [bskyPassword, setBskyPassword] = useState("");

  const [xClientId, setXClientId] = useState("");
  const [xBearerToken, setXBearerToken] = useState("");

  const [nostrKeyInput, setNostrKeyInput] = useState("");
  const [nostrPubkeyPreview, setNostrPubkeyPreview] = useState("");

  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [devtoKey, setDevtoKey] = useState("");

  const origin = useMemo(
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    [],
  );
  const vaultRedirectUri = origin ? `${origin}/vault` : "/vault";

  const syncSavedCreds = useCallback(async (newCreds: Record<string, string>, providerId: string) => {
    const { all } = saveClientCredentials(newCreds);
    setClientCreds(all);
    notifyCredentialsChanged();
    if (!cloudMode) {
      await fetch("/api/credentials/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: newCreds }),
      }).catch(() => {});
    }
    if (onConnected) {
      await onConnected(all, providerId);
    }
  }, [cloudMode, onConnected]);

  // Load initial client credentials + server OAuth status
  useEffect(() => {
    const saved = getClientCredentials();
    setClientCreds(saved);
    setGoogleClientId(saved.GOOGLE_OAUTH_CLIENT_ID || "");
    setDiscordClientId(saved.DISCORD_OAUTH_CLIENT_ID || "");
    setXClientId(saved.X_OAUTH_CLIENT_ID || "");
    setMastodonHost(saved.MASTODON_HOST || "mastodon.social");
    setMisskeyHost(saved.MISSKEY_HOST || "misskey.io");
    setStoatApiUrl(saved.REVOLT_API_URL || "https://api.stoat.chat");
    setStoatChannelId(saved.REVOLT_CHANNEL_ID || "");
    setMatrixHomeserver(saved.MATRIX_HOMESERVER_URL || "https://matrix-client.matrix.org");
    setMatrixRoomId(saved.MATRIX_ROOM_ID || "");
    setBskyIdentifier(saved.BLUESKY_IDENTIFIER || "");
    setTelegramChatId(saved.TELEGRAM_CHAT_ID || "");

    fetch("/api/credentials/oauth", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.oauthReady) setOauthReady(data.oauthReady);
      })
      .catch(() => {});

    const companionUrl = getSavedCompanionUrl() || (!cloudMode ? "" : "");
    if (companionUrl || !cloudMode) {
      fetch("/api/credentials/status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.services?.stealthWorker) setCompanionReachable(true);
        })
        .catch(() => {});
    }
  }, [cloudMode]);

  // Complete returning OAuth2 / MiAuth redirect cleanly
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthErr = params.get("error");
    if (oauthErr) {
      setStatusMsg({
        ok: false,
        text: `OAuth canceled or denied: ${params.get("error_description") || oauthErr}`,
      });
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const code = params.get("code");
    const state = params.get("state");
    const oauthProviderParam = params.get("oauth_provider");
    const miSession = params.get("session");
    const miHost = params.get("host");

    if (!code && !miSession) return;

    let sessionMeta: Record<string, string> = {};
    try {
      const raw = window.sessionStorage.getItem(OAUTH_SESSION_STORAGE_KEY);
      if (raw) sessionMeta = JSON.parse(raw) as Record<string, string>;
    } catch {}

    const inferredProvider =
      oauthProviderParam ||
      sessionMeta.provider ||
      (state?.includes(".") ? state.split(".")[0] : "");

    if (!inferredProvider) return;

    setBusyId(inferredProvider);
    setStatusMsg({ ok: true, text: `Completing ${inferredProvider} 1-click sign-in...` });

    fetch("/api/credentials/oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange",
        provider: inferredProvider,
        code,
        sessionId: miSession || sessionMeta.sessionId,
        host: miHost || sessionMeta.host,
        clientId: sessionMeta.clientId,
        clientSecret: sessionMeta.clientSecret,
        codeVerifier: sessionMeta.codeVerifier,
        redirectUri: sessionMeta.redirectUri || vaultRedirectUri,
      }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        if (data?.ok && data.credentials) {
          await syncSavedCreds(data.credentials, inferredProvider);
          setStatusMsg({ ok: true, text: data.message || `Connected ${inferredProvider}.` });
        } else {
          setStatusMsg({ ok: false, text: data?.message || `OAuth callback failed for ${inferredProvider}.` });
        }
      })
      .catch((err) => {
        setStatusMsg({ ok: false, text: err?.message || "OAuth completion failed." });
      })
      .finally(() => {
        try {
          window.sessionStorage.removeItem(OAUTH_SESSION_STORAGE_KEY);
        } catch {}
        window.history.replaceState({}, "", window.location.pathname);
        setBusyId(null);
      });
  }, [syncSavedCreds, vaultRedirectUri]);

  const startOAuthRedirect = async (
    provider: "mastodon" | "misskey" | "google" | "discord" | "x",
    opts?: { host?: string; clientId?: string; clientSecret?: string },
  ) => {
    setBusyId(provider);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/credentials/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          provider,
          host: opts?.host,
          clientId: opts?.clientId,
          clientSecret: opts?.clientSecret,
          redirectPath: "/vault",
        }),
      });
      const data = await res.json();
      if (data.needsClientConfig) {
        setActiveId(provider);
        setStatusMsg({ ok: true, text: data.message });
        return;
      }
      if (!data.ok || !data.authUrl) {
        setStatusMsg({ ok: false, text: data.message || `Could not start ${provider} sign-in.` });
        return;
      }
      if (data.oauthSession && typeof window !== "undefined") {
        window.sessionStorage.setItem(OAUTH_SESSION_STORAGE_KEY, JSON.stringify(data.oauthSession));
      }
      window.location.href = data.authUrl;
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err?.message || `Failed to start ${provider} sign-in.` });
    } finally {
      setBusyId(null);
    }
  };

  const handleNostrOneClick = async () => {
    setBusyId("nostr");
    setStatusMsg(null);
    try {
      const res = await fetch("/api/credentials/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "nostr_generate" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.credentials) {
        setStatusMsg({ ok: false, text: data.message || "Nostr key creation failed." });
        return;
      }
      setNostrPubkeyPreview(data.publicKeyHex || "");
      await syncSavedCreds(data.credentials, "nostr");
      setStatusMsg({ ok: true, text: data.message });
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err?.message || "Nostr setup failed." });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveAndVerify = async (
    providerId: string,
    updates: Record<string, string>,
    testProviderId: string = providerId,
  ) => {
    setBusyId(providerId);
    setStatusMsg(null);
    try {
      const allNext = { ...clientCreds, ...updates };
      const testRes = await fetch("/api/credentials/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: testProviderId, credentials: allNext }),
      });
      const testData = await testRes.json();
      if (!testRes.ok || !testData.ok) {
        setStatusMsg({ ok: false, text: testData.message || `Verification failed for ${providerId}.` });
        return;
      }
      await syncSavedCreds(updates, providerId);
      setStatusMsg({ ok: true, text: testData.message || `Connected ${providerId}.` });
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err?.message || `Could not verify ${providerId}.` });
    } finally {
      setBusyId(null);
    }
  };

  const handleStoatSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId("stoat");
    setStatusMsg(null);
    try {
      const res = await fetch("/api/credentials/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stoat_login",
          apiUrl: stoatApiUrl,
          email: stoatEmail,
          password: stoatPassword,
          channelId: stoatChannelId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMsg({ ok: false, text: data.message || "Stoat sign-in failed." });
        return;
      }
      if (Array.isArray(data.discoveredChannels)) {
        setStoatChannels(data.discoveredChannels);
        if (!stoatChannelId && data.discoveredChannels[0]?.id) {
          setStoatChannelId(data.discoveredChannels[0].id);
        }
      }
      if (data.credentials) {
        await syncSavedCreds(data.credentials, "stoat");
      }
      setStoatPassword("");
      setStatusMsg({ ok: true, text: data.message });
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err?.message || "Stoat sign-in request failed." });
    } finally {
      setBusyId(null);
    }
  };

  const handleMatrixSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId("matrix");
    setStatusMsg(null);
    try {
      const res = await fetch("/api/credentials/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "matrix_login",
          homeserver: matrixHomeserver,
          username: matrixUsername,
          password: matrixPassword,
          roomId: matrixRoomId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMsg({ ok: false, text: data.message || "Matrix sign-in failed." });
        return;
      }
      if (Array.isArray(data.discoveredRooms)) {
        setMatrixRooms(data.discoveredRooms);
        if (!matrixRoomId && data.discoveredRooms[0]) {
          setMatrixRoomId(data.discoveredRooms[0]);
        }
      }
      if (data.credentials) {
        await syncSavedCreds(data.credentials, "matrix");
      }
      setMatrixPassword("");
      setStatusMsg({ ok: true, text: data.message });
    } catch (err: any) {
      setStatusMsg({ ok: false, text: err?.message || "Matrix sign-in request failed." });
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickButtonClick = async (p: QuickProviderMeta) => {
    setStatusMsg(null);
    if (p.id === "nostr") {
      if (!isConnected("nostr")) {
        await handleNostrOneClick();
        setActiveId("nostr");
      } else {
        setActiveId((prev) => (prev === "nostr" ? null : "nostr"));
      }
      return;
    }

    if (p.id === "google" && (oauthReady.google || googleClientId.trim())) {
      await startOAuthRedirect("google", { clientId: googleClientId.trim() || undefined });
      return;
    }
    if (p.id === "discord" && (oauthReady.discord || (discordClientId.trim() && discordClientSecret.trim()))) {
      await startOAuthRedirect("discord", {
        clientId: discordClientId.trim() || undefined,
        clientSecret: discordClientSecret.trim() || undefined,
      });
      return;
    }
    if (p.id === "x" && (oauthReady.x || xClientId.trim())) {
      await startOAuthRedirect("x", { clientId: xClientId.trim() || undefined });
      return;
    }

    setActiveId((prev) => (prev === p.id ? null : p.id));
  };

  const isConnected = (flagKey: string) => Boolean(apiFlags[flagKey]);

  const primaryList = QUICK_PROVIDERS.filter((p) => p.tier === "primary");
  const moreList = QUICK_PROVIDERS.filter((p) => p.tier === "more");
  const hasQuickFilter = Boolean(providerSearch.trim() || letterFilter !== "all");
  const availableQuickLetters = useMemo(
    () => new Set(QUICK_PROVIDERS.map((p) => p.label.trim().charAt(0).toUpperCase()).filter(Boolean)),
    [],
  );
  const visibleList = (hasQuickFilter || showMore ? [...primaryList, ...moreList] : primaryList).filter((p) =>
    matchesSearchAndLetter(p.label, p.id, providerSearch, letterFilter, p.subtitle),
  );

  return (
    <section className="rounded-xl border border-[#cccccc] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#cccccc]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#999999]" />
          <div>
            <h2 className="text-sm font-semibold text-[#333333]">
              1-Click Sign-Up & Quick Connect
            </h2>
            <p className="text-xs text-[#999999]">
              One-click account creation, Fediverse OAuth, email login, or instant webhook connect.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="bg-white px-2.5 py-1 text-xs font-medium text-[#666666] hover:font-bold hover:text-[#333333] cursor-pointer"
          >
            {showMore ? "Fewer Providers" : `More (+${moreList.length})`}
          </button>
          {compact && (
            <Link
              href="/vault"
              className="bg-white px-2.5 py-1 text-xs font-medium text-[#666666] no-underline hover:font-bold hover:text-[#333333]"
            >
              All 37+ Keys & Vault
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3">
        <LetterFilterBar
          searchQuery={providerSearch}
          onSearchChange={setProviderSearch}
          selectedLetter={letterFilter}
          onLetterChange={setLetterFilter}
          availableLetters={availableQuickLetters}
          searchPlaceholder="Filter 1-click sign-up: google, discord, fluxer, stoat, bluesky, nostr, mastodon, matrix, pinterest..."
        />
      </div>

      {statusMsg && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[#cccccc] bg-white px-3 py-2 text-xs">
          <span className={statusMsg.ok ? "font-medium text-[#333333]" : "font-medium text-[#666666]"}>
            {statusMsg.text}
          </span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-[#999999] hover:text-[#333333]"
            aria-label="Dismiss status"
          >
            <X className="h-3.5 w-3.5 text-[#999999]" />
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {visibleList.length === 0 && (
          <div className="col-span-full rounded-lg border border-[#cccccc] bg-white px-3 py-2 text-xs text-[#666666]">
            No 1-click providers matched &ldquo;{providerSearch || letterFilter}&rdquo;.
          </div>
        )}
        {visibleList.map((p) => {
          const connected = isConnected(p.flagKey);
          const selected = activeId === p.id;
          const busy = busyId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => void handleQuickButtonClick(p)}
              className={`group flex flex-col items-start justify-between gap-1.5 rounded-lg border border-[#cccccc] bg-white p-2.5 text-left transition ${
                selected ? "font-bold text-[#333333]" : "hover:font-bold"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <BrandIcon id={p.id} />
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#999999]" />
                ) : connected ? (
                  <Check className="h-3.5 w-3.5 text-[#999999]" />
                ) : null}
              </div>
              <div className="w-full">
                <div
                  className={`truncate text-xs ${
                    selected || connected
                      ? "font-bold text-[#333333]"
                      : "font-medium text-[#333333] group-hover:font-bold"
                  }`}
                >
                  {p.label}
                </div>
                <div className="truncate text-[10px] text-[#999999]">
                  {connected ? "Connected" : p.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Inline 1-Click Action Drawer */}
      {activeId && (
        <div className="mt-3 rounded-lg border border-[#cccccc] bg-white p-3.5">
          <div className="mb-2.5 flex items-center justify-between border-b border-[#cccccc] pb-2">
            <span className="text-xs font-semibold text-[#333333]">
              Quick Connect: {QUICK_PROVIDERS.find((x) => x.id === activeId)?.label || activeId}
            </span>
            <button
              type="button"
              onClick={() => setActiveId(null)}
              className="rounded border border-[#cccccc] bg-white p-1 text-[#999999] hover:text-[#333333]"
              aria-label="Close quick connect drawer"
            >
              <X className="h-3.5 w-3.5 text-[#999999]" />
            </button>
          </div>

          {activeId === "nostr" && (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === "nostr"}
                  onClick={() => void handleNostrOneClick()}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  {busyId === "nostr" ? "Generating..." : "1-Click Create New Nostr Keypair"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const win = window as any;
                    if (!win.nostr?.getPublicKey) {
                      setStatusMsg({ ok: false, text: "No NIP-07 extension (nos2x / Alby) detected in browser. Use 1-Click Create New Nostr Keypair instead." });
                      return;
                    }
                    const pk = await win.nostr.getPublicKey();
                    setNostrPubkeyPreview(String(pk));
                    setStatusMsg({ ok: true, text: `Detected NIP-07 pubkey ${String(pk).slice(0, 14)}... Server auto-posting still needs a signing hex key below.` });
                  }}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-medium text-[#666666] hover:text-[#333333]"
                >
                  Detect NIP-07 Extension
                </button>
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("nostr")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login (Nostr)
                  </button>
                )}
              </div>
              {nostrPubkeyPreview && (
                <p className="font-mono text-[11px] text-[#666666]">
                  Active Pubkey: {nostrPubkeyPreview}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={nostrKeyInput}
                  onChange={(e) => setNostrKeyInput(e.target.value)}
                  placeholder="Or paste existing 64-char hex NOSTR_PRIVATE_KEY"
                  className="min-w-[240px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() =>
                    void handleSaveAndVerify("nostr", {
                      NOSTR_PRIVATE_KEY: nostrKeyInput.trim(),
                      NOSTR_RELAYS: "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net",
                    })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Save Key
                </button>
              </div>
            </div>
          )}

          {activeId === "mastodon" && (
            <div className="space-y-2.5 text-xs">
              <p className="text-[#666666]">
                Zero-config Fediverse OAuth2: works out of the box with any Mastodon, Pleroma, or Pixelfed server.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {["mastodon.social", "mstdn.social", "fosstodon.org", "hachyderm.io"].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setMastodonHost(h)}
                    className={`rounded border border-[#cccccc] bg-white px-2 py-1 text-[11px] ${
                      mastodonHost === h ? "font-semibold text-[#333333]" : "text-[#666666]"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={mastodonHost}
                  onChange={(e) => setMastodonHost(e.target.value)}
                  placeholder="mastodon.social"
                  className="min-w-[200px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "mastodon"}
                  onClick={() => void startOAuthRedirect("mastodon", { host: mastodonHost })}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  {busyId === "mastodon" ? "Connecting..." : `Authorize 1-Click on ${mastodonHost || "mastodon.social"}`}
                </button>
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("mastodon")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login
                  </button>
                )}
              </div>
            </div>
          )}

          {activeId === "misskey" && (
            <div className="space-y-2.5 text-xs">
              <p className="text-[#666666]">
                One-click MiAuth sign-in for Misskey, Sharkey, and Firefish instances.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={misskeyHost}
                  onChange={(e) => setMisskeyHost(e.target.value)}
                  placeholder="misskey.io"
                  className="min-w-[200px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "misskey"}
                  onClick={() => void startOAuthRedirect("misskey", { host: misskeyHost })}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Authorize via MiAuth
                </button>
              </div>
            </div>
          )}

          {activeId === "google" && (
            <div className="space-y-2.5 text-xs">
              <p className="text-[#666666]">
                Sign in with Google for YouTube & identity. Authorized Redirect URI:{" "}
                <code className="rounded border border-[#cccccc] px-1.5 py-0.5 text-[11px] text-[#333333]">
                  {vaultRedirectUri}
                </code>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("youtube")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    1-Click Companion Chrome Sign-In {companionReachable ? "(Online)" : ""}
                  </button>
                )}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 font-medium text-[#666666] hover:text-[#333333]"
                >
                  Google Cloud Console <ExternalLink className="h-3 w-3 text-[#999999]" />
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="Google OAuth Client ID (xxx.apps.googleusercontent.com)"
                  className="min-w-[230px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() => void startOAuthRedirect("google", { clientId: googleClientId.trim() })}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Continue with Google OAuth
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={googleAccessToken}
                  onChange={(e) => setGoogleAccessToken(e.target.value)}
                  placeholder="Or paste Google OAuth2 Access Token (ya29....)"
                  className="min-w-[230px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() =>
                    void handleSaveAndVerify("google", { GOOGLE_ACCESS_TOKEN: googleAccessToken.trim() })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Save Token
                </button>
              </div>
            </div>
          )}

          {activeId === "discord" && (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={discordWebhook}
                  onChange={(e) => setDiscordWebhook(e.target.value)}
                  placeholder="Instant: Paste Discord Webhook URL (Server -> Integrations -> Webhooks)"
                  className="min-w-[260px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "discord"}
                  onClick={() =>
                    void handleSaveAndVerify("discord", { WEBHOOK_DISCORD_WEBHOOK: discordWebhook.trim() })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Connect
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#cccccc]">
                <input
                  value={discordClientId}
                  onChange={(e) => setDiscordClientId(e.target.value)}
                  placeholder="Optional 1-Click OAuth Client ID"
                  className="w-44 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  type="password"
                  value={discordClientSecret}
                  onChange={(e) => setDiscordClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  className="w-44 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() =>
                    void startOAuthRedirect("discord", {
                      clientId: discordClientId.trim(),
                      clientSecret: discordClientSecret.trim(),
                    })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Authorize Discord OAuth
                </button>
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("discord")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login (Discord)
                  </button>
                )}
              </div>
            </div>
          )}

          {activeId === "fluxer" && (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={fluxerWebhook}
                  onChange={(e) => setFluxerWebhook(e.target.value)}
                  placeholder="https://fluxer.app/api/webhooks/..."
                  className="min-w-[240px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "fluxer"}
                  onClick={() =>
                    void handleSaveAndVerify("fluxer", { WEBHOOK_FLUXER_WEBHOOK: fluxerWebhook.trim() })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Connect Fluxer
                </button>
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("fluxer")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login (Fluxer)
                  </button>
                )}
              </div>
            </div>
          )}

          {activeId === "stoat" && (
            <form onSubmit={handleStoatSignIn} className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[#666666]">
                  Sign in with your Stoat / Revolt account credentials to obtain a live session token automatically.
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["https://api.stoat.chat", "https://api.revolt.chat"].map((presetUrl) => (
                    <button
                      key={presetUrl}
                      type="button"
                      onClick={() => setStoatApiUrl(presetUrl)}
                      className={`rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] ${
                        stoatApiUrl === presetUrl ? "font-semibold text-[#333333]" : "text-[#666666]"
                      }`}
                    >
                      {presetUrl.replace("https://", "")}
                    </button>
                  ))}
                  {onOpenBrowserLogin && (
                    <button
                      type="button"
                      onClick={() => onOpenBrowserLogin("stoat")}
                      className="rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#333333]"
                    >
                      Chrome Login
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={stoatApiUrl}
                  onChange={(e) => setStoatApiUrl(e.target.value)}
                  placeholder="https://api.stoat.chat"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  value={stoatChannelId}
                  onChange={(e) => setStoatChannelId(e.target.value)}
                  placeholder="Target Channel ID (optional — auto-detects DMs)"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  type="email"
                  required
                  value={stoatEmail}
                  onChange={(e) => setStoatEmail(e.target.value)}
                  placeholder="Stoat Email"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  type="password"
                  required
                  value={stoatPassword}
                  onChange={(e) => setStoatPassword(e.target.value)}
                  placeholder="Password"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
              </div>
              {stoatChannels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[#999999]">Detected Channels:</span>
                  {stoatChannels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        setStoatChannelId(ch.id);
                        void syncSavedCreds({ REVOLT_CHANNEL_ID: ch.id }, "stoat");
                      }}
                      className="rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] text-[#333333]"
                    >
                      {ch.label} ({ch.id.slice(0, 8)}...)
                    </button>
                  ))}
                </div>
              )}
              <button
                type="submit"
                disabled={busyId === "stoat"}
                className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
              >
                {busyId === "stoat" ? "Signing in..." : "1-Click Sign In to Stoat"}
              </button>
            </form>
          )}

          {activeId === "bluesky" && (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#666666]">Connect using your Bluesky handle & App Password.</span>
                <div className="flex flex-wrap items-center gap-2">
                  {onOpenBrowserLogin && (
                    <button
                      type="button"
                      onClick={() => onOpenBrowserLogin("bluesky")}
                      className="rounded border border-[#cccccc] bg-white px-2.5 py-1 font-semibold text-[#333333]"
                    >
                      Companion Chrome Login (Bluesky)
                    </button>
                  )}
                  <a
                    href="https://bsky.app/settings/app-passwords"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[#cccccc] bg-white px-2 py-1 font-medium text-[#666666] hover:text-[#333333]"
                  >
                    Open bsky.app App Passwords <ExternalLink className="h-3 w-3 text-[#999999]" />
                  </a>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={bskyIdentifier}
                  onChange={(e) => setBskyIdentifier(e.target.value)}
                  placeholder="yourname.bsky.social"
                  className="min-w-[180px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  type="password"
                  value={bskyPassword}
                  onChange={(e) => setBskyPassword(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  className="min-w-[180px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "bluesky"}
                  onClick={() =>
                    void handleSaveAndVerify("bluesky", {
                      BLUESKY_IDENTIFIER: bskyIdentifier.trim(),
                      BLUESKY_PASSWORD: bskyPassword.trim(),
                    })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Connect Bluesky
                </button>
              </div>
            </div>
          )}

          {activeId === "x" && (
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("x")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    1-Click Companion Chrome Login (X)
                  </button>
                )}
                <span className="text-[#999999]">Redirect URI: {vaultRedirectUri}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={xClientId}
                  onChange={(e) => setXClientId(e.target.value)}
                  placeholder="X OAuth2 Client ID (PKCE)"
                  className="min-w-[200px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() => void startOAuthRedirect("x", { clientId: xClientId.trim() })}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Authorize via X OAuth2
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={xBearerToken}
                  onChange={(e) => setXBearerToken(e.target.value)}
                  placeholder="Or paste X API v2 Token (X_BEARER_TOKEN)"
                  className="min-w-[200px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveAndVerify("x", { X_BEARER_TOKEN: xBearerToken.trim() })}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Save X Token
                </button>
              </div>
            </div>
          )}

          {activeId === "telegram" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="@BotFather Token (123456:ABC...)"
                className="min-w-[180px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
              />
              <input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="@your_channel"
                className="w-40 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
              />
              <button
                type="button"
                onClick={() =>
                  void handleSaveAndVerify("telegram", {
                    TELEGRAM_BOT_TOKEN: telegramToken.trim(),
                    TELEGRAM_CHAT_ID: telegramChatId.trim(),
                  })
                }
                className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
              >
                Verify & Connect
              </button>
            </div>
          )}

          {activeId === "slack" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="password"
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="min-w-[240px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
              />
              <button
                type="button"
                onClick={() =>
                  void handleSaveAndVerify("slack", { WEBHOOK_SLACK_WEBHOOK: slackWebhook.trim() })
                }
                className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
              >
                Verify & Connect Slack
              </button>
            </div>
          )}

          {activeId === "devto" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="password"
                value={devtoKey}
                onChange={(e) => setDevtoKey(e.target.value)}
                placeholder="Dev.to API Key (dev.to/settings/extensions)"
                className="min-w-[240px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
              />
              <button
                type="button"
                onClick={() => void handleSaveAndVerify("devto", { DEVTO_API_KEY: devtoKey.trim() })}
                className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
              >
                Verify & Connect Dev.to
              </button>
            </div>
          )}

          {activeId === "matrix" && (
            <form onSubmit={handleMatrixSignIn} className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#666666]">
                  1-Click sign into your Matrix homeserver (discovers joined rooms automatically) or paste an Access Token.
                </span>
                {onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("matrix")}
                    className="rounded border border-[#cccccc] bg-white px-2.5 py-1 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login (Element)
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={matrixHomeserver}
                  onChange={(e) => setMatrixHomeserver(e.target.value)}
                  placeholder="https://matrix-client.matrix.org"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  value={matrixRoomId}
                  onChange={(e) => setMatrixRoomId(e.target.value)}
                  placeholder="Target Room ID (optional — !room:matrix.org)"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  required
                  value={matrixUsername}
                  onChange={(e) => setMatrixUsername(e.target.value)}
                  placeholder="Matrix Username (@alice:matrix.org)"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <input
                  type="password"
                  required
                  value={matrixPassword}
                  onChange={(e) => setMatrixPassword(e.target.value)}
                  placeholder="Matrix Password"
                  className="rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
              </div>
              {matrixRooms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[#999999]">Joined Rooms:</span>
                  {matrixRooms.map((rm) => (
                    <button
                      key={rm}
                      type="button"
                      onClick={() => {
                        setMatrixRoomId(rm);
                        void syncSavedCreds({ MATRIX_ROOM_ID: rm }, "matrix");
                      }}
                      className="rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] text-[#333333]"
                    >
                      {rm}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={busyId === "matrix"}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  {busyId === "matrix" ? "Signing in..." : "1-Click Sign In to Matrix"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#cccccc]">
                <input
                  type="password"
                  value={matrixTokenInput}
                  onChange={(e) => setMatrixTokenInput(e.target.value)}
                  placeholder="Or paste existing MATRIX_ACCESS_TOKEN"
                  className="min-w-[220px] flex-1 rounded-lg border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#333333]"
                />
                <button
                  type="button"
                  disabled={busyId === "matrix"}
                  onClick={() =>
                    void handleSaveAndVerify("matrix", {
                      MATRIX_HOMESERVER_URL: matrixHomeserver.trim() || "https://matrix-client.matrix.org",
                      MATRIX_ACCESS_TOKEN: matrixTokenInput.trim(),
                      ...(matrixRoomId.trim() ? { MATRIX_ROOM_ID: matrixRoomId.trim() } : {}),
                    })
                  }
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Verify & Save Matrix Token
                </button>
              </div>
            </form>
          )}

          {activeId === "pinterest" && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[#666666]">
                Pinterest publishing uses persistent Creator browser sessions or pasted cookies in Vault.
              </span>
              {onOpenBrowserLogin ? (
                <button
                  type="button"
                  onClick={() => onOpenBrowserLogin("pinterest")}
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  1-Click Companion Chrome Login (Pinterest)
                </button>
              ) : (
                <Link
                  href="/vault"
                  className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                >
                  Open Pinterest Setup in Vault
                </Link>
              )}
            </div>
          )}

          {["reddit", "farcaster", "wordpress"].includes(activeId) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[#666666]">
                Configure {activeId} fields & verify live in API Key Manager.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {activeId === "reddit" && onOpenBrowserLogin && (
                  <button
                    type="button"
                    onClick={() => onOpenBrowserLogin("reddit")}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Companion Chrome Login (Reddit)
                  </button>
                )}
                {onSelectProvider ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProvider(activeId);
                      setActiveId(null);
                    }}
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Configure {activeId} Keys
                  </button>
                ) : (
                  <Link
                    href="/vault"
                    className="rounded-lg border border-[#cccccc] bg-white px-3 py-1.5 font-semibold text-[#333333]"
                  >
                    Open {activeId} Setup in Vault
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { CryptoCheckoutDialog } from "@/components/CryptoCheckoutDialog";
import { getClientCredentials, saveClientCredentials } from "@/lib/client-vault";
import { notifyCredentialsChanged } from "@/lib/companion-bridge";
import {
  ECOSYSTEM_PROJECTS,
  LICENSE_CHANGED_EVENT,
  PLAN_TIERS,
  type PlanTier,
  type StoredLicenseState,
  clearClientPlanLicense,
  getClientPlanLicense,
  isValidEvmAddress,
  isValidSolanaAddress,
  saveClientPlanLicense,
} from "@/lib/plans";

interface TreasurySummary {
  evmConfigured: boolean;
  solanaConfigured: boolean;
  nowpaymentsConfigured: boolean;
  licenseSigningConfigured: boolean;
  evmAddress: string | null;
  solanaAddress: string | null;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const CROSS_APP_VERIFIER_SNIPPET = `// Drop into Fathom Crypto Dashboard, PhoenixChat, Fedipress Buzz, Voice, or VoiceStudio
export async function verifyPolyPostEcosystemPass(token: string) {
  const res = await fetch("https://autopost-gilt-gamma.vercel.app/api/billing/validate-license", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  return Boolean(res.ok && data.valid && data.payload?.apps?.includes("crypto-dashboard"));
}`;

export function PlansBillingSection() {
  const [selectedPlan, setSelectedPlan] = useState<PlanTier | null>(null);
  const [activeLicense, setActiveLicense] = useState<StoredLicenseState | null>(null);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [customEvmAddress, setCustomEvmAddress] = useState("");
  const [customSolAddress, setCustomSolAddress] = useState("");
  const [treasuryFeedback, setTreasuryFeedback] = useState("");
  const [pasteToken, setPasteToken] = useState("");
  const [tokenFeedback, setTokenFeedback] = useState("");
  const [copyStatusText, setCopyStatusText] = useState("");

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncementRef = useRef("");

  const syncLicenseAndTreasury = () => {
    setActiveLicense(getClientPlanLicense());
    const creds = getClientCredentials();
    if (creds.POLYPOST_TREASURY_EVM_ADDRESS) {
      setCustomEvmAddress(creds.POLYPOST_TREASURY_EVM_ADDRESS);
    }
    if (creds.POLYPOST_TREASURY_SOL_ADDRESS) {
      setCustomSolAddress(creds.POLYPOST_TREASURY_SOL_ADDRESS);
    }
  };

  useEffect(() => {
    syncLicenseAndTreasury();
    window.addEventListener(LICENSE_CHANGED_EVENT, syncLicenseAndTreasury);
    void (async () => {
      try {
        const res = await fetch("/api/billing/plans", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { treasury?: TreasurySummary };
          if (data.treasury) {
            setTreasury(data.treasury);
            if (data.treasury.evmAddress) setCustomEvmAddress(data.treasury.evmAddress);
            if (data.treasury.solanaAddress) setCustomSolAddress(data.treasury.solanaAddress);
          }
        }
      } catch {
        // Non-fatal in offline mode
      }
    })();
    return () => {
      window.removeEventListener(LICENSE_CHANGED_EVENT, syncLicenseAndTreasury);
    };
  }, []);

  const currentPlanId = activeLicense?.planId ?? "free";

  const copyTextWithLiveStatus = async (text: string, label: string) => {
    if (!text) return;
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    let msg = `Copied ${label}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      msg = `Copy failed for ${label}`;
    }
    if (msg === lastAnnouncementRef.current) {
      msg += "\u00A0";
    }
    lastAnnouncementRef.current = msg;
    setCopyStatusText(msg);
    copyTimerRef.current = setTimeout(() => {
      setCopyStatusText("");
    }, 2000);
  };

  const handleSaveTreasury = async (e: React.FormEvent) => {
    e.preventDefault();
    const evm = customEvmAddress.trim();
    const sol = customSolAddress.trim();
    if (evm && !isValidEvmAddress(evm)) {
      setTreasuryFeedback("Enter a valid 0x EVM receiving wallet address (42 hex characters).");
      return;
    }
    if (sol && !isValidSolanaAddress(sol)) {
      setTreasuryFeedback("Enter a valid Solana base58 receiving wallet address.");
      return;
    }
    saveClientCredentials({
      POLYPOST_TREASURY_EVM_ADDRESS: evm ? evm.toLowerCase() : null,
      POLYPOST_TREASURY_SOL_ADDRESS: sol || null,
    });
    notifyCredentialsChanged();

    try {
      const res = await fetch("/api/billing/configure-treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evmAddress: evm || undefined,
          solanaAddress: sol || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        persistedToServerEnv?: boolean;
        treasury?: TreasurySummary;
        error?: string;
      };
      if (res.ok && data.treasury) {
        setTreasury(data.treasury);
        setTreasuryFeedback(
          data.persistedToServerEnv
            ? "Saved receiving wallet to local .env and browser vault. Live crypto checkout is ready."
            : "Saved receiving wallet in browser vault. Live crypto quotes, payment URIs, and RPC verification are ready.",
        );
      } else {
        setTreasuryFeedback(data.error || "Saved receiving wallet to browser vault.");
      }
    } catch {
      setTreasuryFeedback("Saved receiving wallet to browser vault.");
    }
  };

  const handleConnectWalletAsTreasury = async () => {
    const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (!ethereum) {
      setTreasuryFeedback("No browser Web3 wallet detected. Paste your 0x receiving address manually.");
      return;
    }
    try {
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const addr = (accounts?.[0] || "").trim().toLowerCase();
      if (!isValidEvmAddress(addr)) {
        setTreasuryFeedback("Wallet did not return a valid 0x address.");
        return;
      }
      setCustomEvmAddress(addr);
      saveClientCredentials({ POLYPOST_TREASURY_EVM_ADDRESS: addr });
      notifyCredentialsChanged();
      setTreasuryFeedback(`Connected ${addr} as your receiving EVM treasury wallet.`);
    } catch (err) {
      setTreasuryFeedback(err instanceof Error ? err.message : "Could not read wallet address.");
    }
  };

  const handleImportLicenseToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = pasteToken.trim();
    if (!token) return;
    setTokenFeedback("Validating pp_eco_v1 signature...");
    try {
      const res = await fetch("/api/billing/validate-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as {
        valid?: boolean;
        reason?: string;
        payload?: {
          planId: PlanTier["id"];
          planName: string;
          priceUsd: number;
          apps: string[];
          txHash: string;
          railId: StoredLicenseState["railId"];
          payerAddress: string;
          recipientAddress?: string;
          iat: number;
          exp: number;
        };
      };
      if (!res.ok || !data.valid || !data.payload) {
        setTokenFeedback(data.reason || "Invalid or expired license token.");
        return;
      }
      const next: StoredLicenseState = {
        token,
        planId: data.payload.planId,
        planName: data.payload.planName,
        priceUsd: data.payload.priceUsd,
        apps: data.payload.apps,
        txHash: data.payload.txHash,
        railId: data.payload.railId,
        payerAddress: data.payload.payerAddress,
        recipientAddress: data.payload.recipientAddress,
        issuedAt: data.payload.iat,
        expiresAt: data.payload.exp,
        verifiedOnChain: true,
      };
      saveClientPlanLicense(next);
      setActiveLicense(next);
      setPasteToken("");
      setTokenFeedback(
        `License activated: ${next.planName} ($${next.priceUsd}/mo) covering ${next.apps.join(", ")}.`,
      );
    } catch (err) {
      setTokenFeedback(err instanceof Error ? err.message : "Could not verify token.");
    }
  };

  const effectiveEvmConfigured = Boolean(
    treasury?.evmConfigured || isValidEvmAddress(customEvmAddress),
  );
  const effectiveSolConfigured = Boolean(
    treasury?.solanaConfigured || isValidSolanaAddress(customSolAddress),
  );

  return (
    <>
      {/* Plans & Billing Header (2 cols) + Active Tier Summary (1 col) */}
      <section id="plans" className="md:col-span-2 bg-white space-y-2 scroll-mt-2">
        <h2 className="text-lg font-bold text-[#333333]">
          Plans, Crypto Checkout &amp; All-Projects Pass
        </h2>
        <p className="text-xs text-[#666666]">
          Simple creator pricing settled directly on-chain in USDC, USDT, or Native ETH (Base, Arbitrum, Polygon, Solana) with 0% gateway markup — or unified through your own{" "}
          <a
            href="https://crypto-dashboard-seven-lime.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-[#333333] hover:font-bold"
          >
            Fathom Crypto Dashboard
          </a>
          .
        </p>

        {activeLicense && (
          <div className="bg-white space-y-1.5 text-xs pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#333333]">
                Verified Portable Ecosystem Token (Use across PolyPost &amp; connected apps)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyTextWithLiveStatus(activeLicense.token, "license token")}
                  className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-xs text-[#666666] hover:font-bold hover:text-[#333333]"
                >
                  Copy Token
                </button>
                <button
                  type="button"
                  onClick={() => clearClientPlanLicense()}
                  className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-xs text-[#666666] hover:font-bold hover:text-[#333333]"
                >
                  Reset Local Pass
                </button>
              </div>
            </div>
            <div className="font-mono text-[11px] text-[#666666] break-all bg-white">
              {activeLicense.token}
            </div>
          </div>
        )}
      </section>

      <section className="md:col-span-1 bg-white text-xs space-y-1 flex flex-col justify-between">
        <div>
          <div className="text-[#999999] uppercase tracking-wide font-bold">Active Tier</div>
          <div className="text-base font-bold text-[#333333] mt-1">
            {activeLicense
              ? `${activeLicense.planName} ($${activeLicense.priceUsd}/mo)`
              : "Free ($0/mo)"}
          </div>
          <div className="text-[#666666] mt-0.5">
            {activeLicense
              ? `Valid until ${new Date(activeLicense.expiresAt).toLocaleDateString()} · ${activeLicense.apps.length} app(s)`
              : "1 account per platform · 5 daily runs"}
          </div>
        </div>
        <div className="text-[11px] text-[#999999] pt-2">
          Direct L2 / Solana settlement keeps 100% of your $3 / $5 / $8 / $10 payment in your wallet.
        </div>
      </section>

      {/* 5 Plan Tiers across 3 columns (Extra $10 flagship spans 2 columns) */}
      {PLAN_TIERS.map((plan) => {
        const isCurrent = currentPlanId === plan.id;
        const spanClass = plan.includesEcosystemMax ? "md:col-span-2" : "md:col-span-1";
        return (
          <article
            key={plan.id}
            className={`${spanClass} bg-white flex flex-col justify-between gap-4`}
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#333333]">{plan.name}</h3>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-[#333333]">${plan.priceUsd}</span>
                    <span className="text-xs text-[#999999]">{plan.billingCycle}</span>
                  </div>
                </div>
                {plan.badge && (
                  <span className="text-[11px] font-bold text-[#999999]">{plan.badge}</span>
                )}
              </div>

              <p className="text-xs text-[#666666] leading-relaxed">{plan.summary}</p>

              <div className="text-xs space-y-1 text-[#666666]">
                <div>
                  Accounts / platform:{" "}
                  <span className="font-bold text-[#333333]">
                    {plan.accountsPerPlatformCap === "unlimited"
                      ? "Unlimited (safety warnings active)"
                      : `Up to ${plan.accountsPerPlatformCap}`}
                  </span>
                </div>
                <div>
                  Daily runs:{" "}
                  <span className="font-bold text-[#333333]">
                    {plan.dailyRunsLimit === "unlimited"
                      ? "Unlimited"
                      : `${plan.dailyRunsLimit} / day`}
                  </span>
                </div>
              </div>

              <ul className="space-y-1 text-xs text-[#666666]">
                {plan.features.map((feat) => (
                  <li key={feat} className="leading-snug">
                    - {feat}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              {plan.priceUsd === 0 ? (
                <button
                  type="button"
                  disabled
                  className="w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-xs text-[#999999]"
                >
                  {isCurrent ? "Current Default Tier" : "Included Always"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedPlan(plan)}
                  className="w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-xs font-bold text-[#333333] hover:font-bold"
                >
                  {isCurrent
                    ? `Pay $${plan.priceUsd} · Extend ${plan.name}`
                    : `Pay $${plan.priceUsd} Crypto · Unlock ${plan.name}`}
                </button>
              )}
            </div>
          </article>
        );
      })}

      {/* Self-Custody Treasury Setup (2 cols) + Restore Ecosystem Token (1 col) */}
      <section className="md:col-span-2 bg-white space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 id="treasury-setup-heading" className="text-sm font-bold text-[#333333]">
              Self-Custody Treasury Wallet Setup
            </h3>
            <p className="text-xs text-[#666666] mt-0.5">
              Configure your own receiving EVM (Base / Arbitrum / Polygon / Ethereum) and Solana wallet addresses so direct crypto checkouts settle straight to your self-custody wallet.
            </p>
          </div>
          <span className="text-xs font-mono text-[#999999]">
            EVM: {effectiveEvmConfigured ? "Ready" : "Unset"} · Solana:{" "}
            {effectiveSolConfigured ? "Ready" : "Unset"}
          </span>
        </div>

        <form
          aria-labelledby="treasury-setup-heading"
          onSubmit={handleSaveTreasury}
          className="space-y-3 text-xs"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <div>
              <label htmlFor="treasury-evm-input" className="text-[#999999] block mb-1">
                Receiving EVM Wallet Address (0x... for Base / Arbitrum / Polygon USDC, USDT &amp; ETH):
              </label>
              <input
                id="treasury-evm-input"
                name="evmAddress"
                type="text"
                value={customEvmAddress}
                onChange={(e) => setCustomEvmAddress(e.target.value)}
                placeholder="0x..."
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 font-mono text-[#333333]"
              />
            </div>
            <div>
              <label htmlFor="treasury-sol-input" className="text-[#999999] block mb-1">
                Receiving Solana Wallet Address (Base58 for Solana USDC):
              </label>
              <input
                id="treasury-sol-input"
                name="solanaAddress"
                type="text"
                value={customSolAddress}
                onChange={(e) => setCustomSolAddress(e.target.value)}
                placeholder="Solana base58 address..."
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 font-mono text-[#333333]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded border border-[#cccccc] bg-white px-3.5 py-1.5 text-xs font-bold text-[#333333] hover:font-bold"
            >
              Save Treasury Wallet Addresses
            </button>
            <button
              type="button"
              onClick={() => void handleConnectWalletAsTreasury()}
              className="rounded border border-[#cccccc] bg-white px-3.5 py-1.5 text-xs text-[#666666] hover:font-bold hover:text-[#333333]"
            >
              Use Connected Browser Wallet (0x)
            </button>
          </div>
          {treasuryFeedback && (
            <p role="status" className="text-xs text-[#333333]">
              {treasuryFeedback}
            </p>
          )}
        </form>
      </section>

      <section className="md:col-span-1 bg-white space-y-2">
        <form
          aria-labelledby="restore-token-heading"
          onSubmit={handleImportLicenseToken}
          className="space-y-2.5 text-xs"
        >
          <h3 id="restore-token-heading" className="text-sm font-bold text-[#333333]">
            Restore or Verify Ecosystem Pass
          </h3>
          <p className="text-xs text-[#666666]">
            Paste an existing <code className="text-[#333333]">pp_eco_v1</code> token to unlock your tier in this browser.
          </p>
          <label htmlFor="ecosystem-token-input" className="sr-only">
            Ecosystem license token
          </label>
          <input
            id="ecosystem-token-input"
            type="text"
            name="ecosystemToken"
            value={pasteToken}
            onChange={(e) => setPasteToken(e.target.value)}
            placeholder="pp_eco_v1.<payload>.<signature>..."
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-xs font-mono text-[#333333]"
          />
          <button
            type="submit"
            disabled={!pasteToken.trim()}
            className="w-full rounded border border-[#cccccc] bg-white px-3 py-1.5 text-xs font-bold text-[#333333] hover:font-bold disabled:opacity-50"
          >
            Validate Token
          </button>
          {tokenFeedback && (
            <p role="status" className="text-xs text-[#666666]">
              {tokenFeedback}
            </p>
          )}
        </form>
      </section>

      {/* Connected Ecosystem Apps (2 cols) + Cross-Project Verifier Code (1 col) */}
      <section className="md:col-span-2 bg-white space-y-2.5">
        <div>
          <h3 className="text-sm font-bold text-[#333333]">
            Extra ($10/mo) — 6 Connected Ecosystem Projects
          </h3>
          <p className="text-xs text-[#666666]">
            One $10 settlement unlocks Max Tier across all 6 deployments via shared <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> or <code className="text-[#333333]">POST /api/billing/validate-license</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">
          {ECOSYSTEM_PROJECTS.map((project) => (
            <div key={project.id} className="ui-cell space-y-1">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-bold text-[#333333] hover:font-bold"
                >
                  {project.name}
                </a>
                <span className="text-[10px] text-[#999999]">{project.tierGranted}</span>
              </div>
              <p className="text-[11px] text-[#666666]">{project.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="md:col-span-1 bg-white space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
            Cross-Project Verifier Code
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void copyTextWithLiveStatus(CROSS_APP_VERIFIER_SNIPPET, "verifier snippet")
              }
              className="rounded border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333]"
            >
              Copy Verifier Code
            </button>
            <span role="status" className="text-[11px] text-[#666666]">
              {copyStatusText}
            </span>
          </div>
        </div>
        <pre className="bg-white text-[10px] font-mono text-[#666666] overflow-x-auto leading-relaxed">
          <code>{CROSS_APP_VERIFIER_SNIPPET}</code>
        </pre>
      </section>

      {/* 3 Crypto Payment Stack Comparison Columns */}
      <section className="md:col-span-1 bg-white space-y-1.5 text-xs text-[#666666]">
        <h3 className="text-xs font-bold text-[#333333]">
          1. Direct L2 / Solana USDC, USDT &amp; ETH + Own Verifier
        </h3>
        <p>
          Built directly into PolyPost (<code className="text-[#333333]">/api/billing/verify</code>), extending the non-custodial JSON-RPC receipt verification in <code className="text-[#333333]">crypto-dashboard/src/lib/ethereum-payment.ts</code>.
        </p>
        <p className="text-[#333333]">
          Base, Arbitrum, Polygon &amp; Solana charge ~$0.0005–$0.005 gas and 0% processor fee.
        </p>
      </section>

      <section className="md:col-span-1 bg-white space-y-1.5 text-xs text-[#666666]">
        <h3 className="text-xs font-bold text-[#333333]">
          2. Connect Your Fathom Crypto Dashboard Hub
        </h3>
        <p>
          Instead of maintaining 6 separate billing backends, <code className="text-[#333333]">crypto-dashboard</code> acts as your central Ecosystem Checkout &amp; License Issuer.
        </p>
        <p className="text-[#333333]">
          Share one <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> env var across Vercel projects.
        </p>
      </section>

      <section className="md:col-span-1 bg-white space-y-1.5 text-xs text-[#666666]">
        <h3 className="text-xs font-bold text-[#333333]">
          3. NOWPayments / Gateways (Optional Fallback Only)
        </h3>
        <p>
          <code className="text-[#333333]">verifyNowPaymentsIpnSignature</code> validates HMAC-SHA512 webhooks cleanly when a buyer insists on BTC, LTC, or XMR.
        </p>
        <p className="text-[#333333]">
          Avoid Ethereum L1 ($1–$5 gas) for $3–$10 plans.
        </p>
      </section>

      <CryptoCheckoutDialog
        plan={selectedPlan}
        customEvmTreasury={customEvmAddress}
        customSolTreasury={customSolAddress}
        onClose={() => setSelectedPlan(null)}
        onActivated={(lic) => {
          setActiveLicense(lic);
        }}
      />
    </>
  );
}

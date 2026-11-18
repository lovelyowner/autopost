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
  // Returns { valid: true, payload: { planId: "extra", apps: ["autopost", "crypto-dashboard", ...] } }
  return Boolean(res.ok && data.valid && data.payload?.apps?.includes("crypto-dashboard"));
}`;

export default function PlansPage() {
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
    <div className="space-y-10 bg-white">
      <section className="bg-white space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl font-bold text-[#333333]">
              Plans, Crypto Checkout &amp; All-Projects Pass
            </h1>
            <p className="text-sm text-[#666666]">
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
          </div>

          <div className="bg-white text-xs space-y-1 min-w-[200px]">
            <div className="text-[#999999] uppercase tracking-wide font-bold">Active Tier</div>
            <div className="text-sm font-bold text-[#333333]">
              {activeLicense
                ? `${activeLicense.planName} ($${activeLicense.priceUsd}/mo)`
                : "Free ($0/mo)"}
            </div>
            <div className="text-[#666666]">
              {activeLicense
                ? `Valid until ${new Date(activeLicense.expiresAt).toLocaleDateString()} · ${activeLicense.apps.length} app(s)`
                : "1 account per platform · Upgrade anytime"}
            </div>
          </div>
        </div>

        {activeLicense && (
          <div className="bg-white space-y-2 text-xs pt-2">
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

      <section className="space-y-5 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-[#333333]">Subscription Tiers ($0 – $10/mo)</h2>
          <span className="text-xs text-[#999999]">
            Direct L2 / Solana settlement keeps 100% of your $3 / $5 / $8 / $10 payment in your wallet.
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-6">
          {PLAN_TIERS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            return (
              <article
                key={plan.id}
                className="bg-white flex flex-col justify-between gap-5 py-2"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-[#333333]">{plan.name}</h3>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-[#333333]">${plan.priceUsd}</span>
                        <span className="text-xs text-[#999999]">{plan.billingCycle}</span>
                      </div>
                    </div>
                    {plan.badge && (
                      <span className="text-[11px] font-bold text-[#999999]">{plan.badge}</span>
                    )}
                  </div>

                  <p className="text-xs text-[#666666] leading-relaxed">{plan.summary}</p>

                  <div className="pt-2 text-xs space-y-1 text-[#666666]">
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

                  <ul className="space-y-1.5 text-xs text-[#666666] pt-2">
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
        </div>
      </section>

      <section className="bg-white space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="treasury-setup-heading" className="text-lg font-bold text-[#333333]">
              Self-Custody Treasury Wallet Setup
            </h2>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 font-mono text-[#333333]"
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
                className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-2 font-mono text-[#333333]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
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

      <section className="bg-white space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-[#333333]">
            Extra ($10/mo) — Cross-Project Max Tier Pass
          </h2>
          <p className="text-xs text-[#666666]">
            One on-chain $10 settlement issues a signed <code className="text-[#333333]">pp_eco_v1</code> HMAC-SHA256 entitlement token recognized across all 6 of your apps via shared <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> or cross-origin <code className="text-[#333333]">POST /api/billing/validate-license</code>.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5">
          {ECOSYSTEM_PROJECTS.map((project) => (
            <div key={project.id} className="bg-white space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold text-[#333333] hover:font-bold"
                >
                  {project.name}
                </a>
                <span className="text-[11px] text-[#999999]">{project.tierGranted}</span>
              </div>
              <p className="text-xs text-[#666666]">{project.summary}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
              Cross-Project Token Verifier Snippet (CORS-Enabled for All 6 Apps)
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void copyTextWithLiveStatus(CROSS_APP_VERIFIER_SNIPPET, "verifier snippet")
                }
                className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-xs text-[#666666] hover:font-bold hover:text-[#333333]"
              >
                Copy Verifier Code
              </button>
              <span role="status" className="text-xs text-[#666666]">
                {copyStatusText}
              </span>
            </div>
          </div>
          <pre className="bg-white text-[11px] font-mono text-[#666666] overflow-x-auto leading-relaxed">
            <code>{CROSS_APP_VERIFIER_SNIPPET}</code>
          </pre>
        </div>

        <form
          aria-labelledby="restore-token-heading"
          onSubmit={handleImportLicenseToken}
          className="pt-3 space-y-2"
        >
          <h3
            id="restore-token-heading"
            className="text-xs font-bold uppercase tracking-wide text-[#666666]"
          >
            Already Have an Ecosystem Token? Restore or Verify Here
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              name="ecosystemToken"
              value={pasteToken}
              onChange={(e) => setPasteToken(e.target.value)}
              placeholder="Paste pp_eco_v1.<payload>.<signature>..."
              aria-label="Ecosystem license token"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="flex-1 bg-white border-0 border-b border-[#cccccc] px-1 py-2 text-xs font-mono text-[#333333]"
            />
            <button
              type="submit"
              disabled={!pasteToken.trim()}
              className="rounded border border-[#cccccc] bg-white px-4 py-2 text-xs font-bold text-[#333333] hover:font-bold disabled:opacity-50"
            >
              Validate Token
            </button>
          </div>
          {tokenFeedback && (
            <p role="status" className="text-xs text-[#666666]">
              {tokenFeedback}
            </p>
          )}
        </form>
      </section>

      <section className="bg-white space-y-4">
        <h2 className="text-lg font-bold text-[#333333]">
          Recommended Crypto Payment Stack ($3–$10 SaaS Tiers)
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6 text-xs text-[#666666]">
          <div className="space-y-2 bg-white">
            <h3 className="text-sm font-bold text-[#333333]">
              1. Direct L2 / Solana USDC, USDT &amp; ETH + Own Verifier (Best)
            </h3>
            <p>
              Built directly into PolyPost (<code className="text-[#333333]">/api/billing/verify</code>), extending the non-custodial JSON-RPC receipt verification you already wrote in <code className="text-[#333333]">crypto-dashboard/src/lib/ethereum-payment.ts</code>.
            </p>
            <p className="text-[#333333]">
              Base, Arbitrum, Polygon &amp; Solana charge ~$0.0005–$0.005 gas, 0% processor fee, zero KYC/custody freeze risk, and exact pricing ($3.00 / $5.00 / $8.00 / $10.00).
            </p>
          </div>

          <div className="space-y-2 bg-white">
            <h3 className="text-sm font-bold text-[#333333]">
              2. Connect Your Fathom Crypto Dashboard Hub
            </h3>
            <p>
              Instead of maintaining 6 separate billing backends, <code className="text-[#333333]">crypto-dashboard</code> can act as your central Ecosystem Checkout &amp; License Issuer for PolyPost, PhoenixChat, Fedipress Buzz, Voice, and VoiceStudio.
            </p>
            <p className="text-[#333333]">
              Share one <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> env var across Vercel projects so a single $10 Extra verification unlocks Max tier everywhere offline in microseconds.
            </p>
          </div>

          <div className="space-y-2 bg-white">
            <h3 className="text-sm font-bold text-[#333333]">
              3. NOWPayments / Gateways (Optional Fallback Only)
            </h3>
            <p>
              Your <code className="text-[#333333]">crypto-dashboard/src/lib/nowpayments.ts</code> and PolyPost&apos;s <code className="text-[#333333]">verifyNowPaymentsIpnSignature</code> validate HMAC-SHA512 webhooks cleanly — keep NOWPayments or BTCPay only when a buyer insists on BTC, LTC, or XMR.
            </p>
            <p className="text-[#333333]">
              Avoid Ethereum L1 ($1–$5 gas ruins a $3 Pro ticket) and avoid custodial gateways as the primary rail for $3–$10 plans because minimum invoice limits &amp; spreads cut margins.
            </p>
          </div>
        </div>
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
    </div>
  );
}

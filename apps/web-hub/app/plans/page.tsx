"use client";

import React, { useEffect, useState } from "react";
import { CryptoCheckoutDialog } from "@/components/CryptoCheckoutDialog";
import {
  ECOSYSTEM_PROJECTS,
  LICENSE_CHANGED_EVENT,
  PLAN_TIERS,
  type PlanTier,
  type StoredLicenseState,
  clearClientPlanLicense,
  getClientPlanLicense,
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

export default function PlansPage() {
  const [selectedPlan, setSelectedPlan] = useState<PlanTier | null>(null);
  const [activeLicense, setActiveLicense] = useState<StoredLicenseState | null>(null);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const [pasteToken, setPasteToken] = useState("");
  const [tokenFeedback, setTokenFeedback] = useState("");
  const [copiedToken, setCopiedToken] = useState(false);

  const syncLicense = () => {
    setActiveLicense(getClientPlanLicense());
  };

  useEffect(() => {
    syncLicense();
    window.addEventListener(LICENSE_CHANGED_EVENT, syncLicense);
    void (async () => {
      try {
        const res = await fetch("/api/billing/plans", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { treasury?: TreasurySummary };
          if (data.treasury) {
            setTreasury(data.treasury);
          }
        }
      } catch {
        // Non-fatal in offline mode
      }
    })();
    return () => {
      window.removeEventListener(LICENSE_CHANGED_EVENT, syncLicense);
    };
  }, []);

  const currentPlanId = activeLicense?.planId ?? "free";

  const handleCopyToken = async () => {
    if (!activeLicense?.token) return;
    try {
      await navigator.clipboard.writeText(activeLicense.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1800);
    } catch {
      // Ignore clipboard failures
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

  return (
    <div className="space-y-10 bg-white">
      <section className="bg-white space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl font-bold text-[#333333]">
              Plans, Crypto Checkout &amp; All-Projects Pass
            </h1>
            <p className="text-sm text-[#666666]">
              Simple creator pricing settled directly on-chain in USDC (Base, Arbitrum, Polygon, Solana) with 0% gateway markup — or unified through your own{" "}
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

        {treasury && !treasury.evmConfigured && !treasury.solanaConfigured && (
          <div className="bg-white text-xs text-[#666666]">
            <span className="font-bold text-[#333333]">Owner Treasury Setup Pending:</span> Set{" "}
            <code className="text-[#333333]">POLYPOST_TREASURY_EVM_ADDRESS</code>,{" "}
            <code className="text-[#333333]">POLYPOST_TREASURY_SOL_ADDRESS</code>, and{" "}
            <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> in your deployment environment variables to accept live USDC settlements to your wallet.
          </div>
        )}

        {activeLicense && (
          <div className="bg-white space-y-2 text-xs pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#333333]">
                Verified Portable Ecosystem Token (Use across PolyPost &amp; connected apps)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyToken}
                  className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-xs text-[#666666] hover:font-bold hover:text-[#333333]"
                >
                  {copiedToken ? "Copied Token" : "Copy Token"}
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
            Direct USDC L2 settlement keeps 100% of your $3 / $5 / $8 / $10 payment in your wallet.
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
                      className={`w-full rounded border border-[#cccccc] bg-white px-3 py-2 text-xs hover:font-bold hover:text-[#333333] ${
                        isCurrent ? "font-bold text-[#333333]" : "text-[#333333] font-bold"
                      }`}
                    >
                      {isCurrent ? `Extend ${plan.name} ($${plan.priceUsd})` : `Unlock ${plan.name} · $${plan.priceUsd} Crypto`}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bg-white space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-[#333333]">
            Extra ($10/mo) — Cross-Project Max Tier Pass
          </h2>
          <p className="text-xs text-[#666666]">
            One on-chain $10 USDC settlement issues a signed <code className="text-[#333333]">pp_eco_v1</code> HMAC-SHA256 entitlement token recognized across all 6 of your apps via shared <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> or <code className="text-[#333333]">POST /api/billing/validate-license</code>.
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

        <form onSubmit={handleImportLicenseToken} className="pt-3 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
            Already Have an Ecosystem Token? Restore or Verify Here
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={pasteToken}
              onChange={(e) => setPasteToken(e.target.value)}
              placeholder="Paste pp_eco_v1.<payload>.<signature>..."
              aria-label="Ecosystem license token"
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
          {tokenFeedback && <p className="text-xs text-[#666666]">{tokenFeedback}</p>}
        </form>
      </section>

      <section className="bg-white space-y-4">
        <h2 className="text-lg font-bold text-[#333333]">
          Recommended Crypto Payment Stack ($3–$10 SaaS Tiers)
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-6 text-xs text-[#666666]">
          <div className="space-y-2 bg-white">
            <h3 className="text-sm font-bold text-[#333333]">
              1. Direct L2 / Solana USDC + Own Verifier (Best)
            </h3>
            <p>
              Built directly into PolyPost (<code className="text-[#333333]">/api/billing/verify</code>), extending the non-custodial JSON-RPC receipt verification you already wrote in <code className="text-[#333333]">crypto-dashboard/src/lib/ethereum-payment.ts</code>.
            </p>
            <p className="text-[#333333]">
              Base, Arbitrum, Polygon &amp; Solana USDC charge ~$0.0005–$0.005 gas, 0% processor fee, zero KYC/custody freeze risk, and exact USD pricing ($3.00 / $5.00 / $8.00 / $10.00).
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
              Your <code className="text-[#333333]">crypto-dashboard/src/lib/nowpayments.ts</code> already validates HMAC-SHA512 webhooks cleanly — keep NOWPayments or BTCPay only when a buyer insists on BTC, LTC, or XMR.
            </p>
            <p className="text-[#333333]">
              Avoid Ethereum L1 ($1–$5 gas ruins a $3 Pro ticket) and avoid custodial gateways as the primary rail for $3–$10 plans because minimum invoice limits &amp; spreads cut margins.
            </p>
          </div>
        </div>
      </section>

      <CryptoCheckoutDialog
        plan={selectedPlan}
        onClose={() => setSelectedPlan(null)}
        onActivated={(lic) => {
          setActiveLicense(lic);
        }}
      />
    </div>
  );
}

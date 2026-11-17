"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, ShieldCheck, Wallet, X } from "lucide-react";
import {
  CRYPTO_RAILS,
  type CryptoRailId,
  type PlanTier,
  type StoredLicenseState,
  saveClientPlanLicense,
} from "@/lib/plans";

interface QuotePayload {
  configured: boolean;
  missingEnvHint: string | null;
  quote: {
    planId: string;
    planName: string;
    priceUsd: number;
    railId: CryptoRailId;
    railName: string;
    chainId: number | null;
    tokenSymbol: string;
    tokenContract: string;
    recipient: string | null;
    baseUnits: string;
    amountDisplay: string;
    estimatedFee: string;
    requiredConfirmations: number;
    txParams: {
      chainId: number;
      chainIdHex: string;
      to: string;
      value: string;
      data: string;
    } | null;
    fathomDashboardUrl: string;
  };
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface CryptoCheckoutDialogProps {
  plan: PlanTier | null;
  onClose: () => void;
  onActivated: (license: StoredLicenseState) => void;
}

export function CryptoCheckoutDialog({ plan, onClose, onActivated }: CryptoCheckoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const backdropDownRef = useRef(false);

  const [railId, setRailId] = useState<CryptoRailId>("base_usdc");
  const [quoteData, setQuoteData] = useState<QuotePayload | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [connectedWallet, setConnectedWallet] = useState("");
  const [submittingWallet, setSubmittingWallet] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copiedField, setCopiedField] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (plan) {
      if (!dlg.open) {
        dlg.showModal();
      }
      setTxHash("");
      setStatusMessage("");
      setErrorMessage("");
    } else if (dlg.open) {
      dlg.close();
    }
  }, [plan]);

  useEffect(() => {
    if (!plan || plan.priceUsd <= 0) {
      setQuoteData(null);
      return;
    }
    let cancelled = false;
    setLoadingQuote(true);
    setErrorMessage("");
    void (async () => {
      try {
        const res = await fetch("/api/billing/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: plan.id, railId }),
        });
        const data = (await res.json()) as QuotePayload & { error?: string };
        if (!cancelled) {
          if (!res.ok) {
            setErrorMessage(data.error || "Could not prepare quote.");
          } else {
            setQuoteData(data);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "Failed to load crypto quote.");
        }
      } finally {
        if (!cancelled) {
          setLoadingQuote(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, railId]);

  const copyText = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(""), 1800);
    } catch {
      // Clipboard blocked in non-HTTPS context
    }
  };

  const verifyHashOnServer = async (hashToVerify: string, walletOverride?: string) => {
    if (!plan) return;
    const cleanHash = hashToVerify.trim();
    if (!cleanHash) {
      setErrorMessage("Paste the confirmed transaction hash or signature first.");
      return;
    }
    setVerifying(true);
    setErrorMessage("");
    setStatusMessage("Querying blockchain RPC receipt & verifying USDC Transfer log...");
    try {
      const res = await fetch("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          railId,
          txHash: cleanHash,
          connectedWallet: walletOverride ?? (connectedWallet || undefined),
        }),
      });
      const data = (await res.json()) as {
        status?: string;
        error?: string;
        reason?: string;
        confirmations?: number;
        requiredConfirmations?: number;
        license?: {
          token: string;
          planId: PlanTier["id"];
          planName: string;
          priceUsd: number;
          apps: string[];
          txHash: string;
          railId: CryptoRailId;
          payerAddress: string;
          iat: number;
          exp: number;
          verifiedOnChain: boolean;
        };
      };

      if (res.status === 202 || data.status === "pending") {
        setStatusMessage(
          data.reason ||
            `Pending finality (${data.confirmations ?? 0}/${data.requiredConfirmations ?? 3} confirmations). Click Verify again in a few seconds.`,
        );
        return;
      }

      if (!res.ok || data.status !== "confirmed" || !data.license) {
        setStatusMessage("");
        setErrorMessage(data.error || data.reason || "Transaction verification failed.");
        return;
      }

      const stored: StoredLicenseState = {
        token: data.license.token,
        planId: data.license.planId,
        planName: data.license.planName,
        priceUsd: data.license.priceUsd,
        apps: data.license.apps,
        txHash: data.license.txHash,
        railId: data.license.railId,
        payerAddress: data.license.payerAddress,
        issuedAt: data.license.iat,
        expiresAt: data.license.exp,
        verifiedOnChain: true,
      };
      saveClientPlanLicense(stored);
      onActivated(stored);
      setStatusMessage(
        `Verified on-chain! ${stored.planName} ($${stored.priceUsd}) unlocked for ${stored.apps.length} app(s).`,
      );
    } catch (err) {
      setStatusMessage("");
      setErrorMessage(err instanceof Error ? err.message : "Verification request failed.");
    } finally {
      setVerifying(false);
    }
  };

  const handleWalletPay = async () => {
    const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (!ethereum) {
      setErrorMessage(
        "No browser Web3 wallet detected (MetaMask / Rabby / Coinbase Wallet). Send USDC manually or open Fathom Crypto Dashboard, then paste the TX hash below.",
      );
      return;
    }
    if (!quoteData?.configured || !quoteData.quote.txParams || !quoteData.quote.recipient) {
      setErrorMessage(
        quoteData?.missingEnvHint || "Treasury receiving wallet is not configured on this server yet.",
      );
      return;
    }

    setSubmittingWallet(true);
    setErrorMessage("");
    setStatusMessage("Requesting wallet account access...");
    try {
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const sender = (accounts?.[0] || "").trim().toLowerCase();
      if (!sender) {
        throw new Error("No wallet account selected.");
      }
      setConnectedWallet(sender);

      const { chainIdHex, to, data, value } = quoteData.quote.txParams;
      setStatusMessage(`Switching wallet to ${quoteData.quote.railName}...`);
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchErr) {
        const msg = switchErr instanceof Error ? switchErr.message : String(switchErr);
        throw new Error(
          `Switch your wallet network to ${quoteData.quote.railName} (${chainIdHex}) and retry (${msg}).`,
        );
      }

      setStatusMessage(`Confirm ${quoteData.quote.amountDisplay} transfer in your wallet...`);
      const sentHash = (await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: sender, to, data, value }],
      })) as string;

      if (typeof sentHash !== "string" || !sentHash.startsWith("0x")) {
        throw new Error("Wallet did not return a valid transaction hash.");
      }
      setTxHash(sentHash);
      await verifyHashOnServer(sentHash, sender);
    } catch (err) {
      setStatusMessage("");
      setErrorMessage(err instanceof Error ? err.message : "Wallet transaction cancelled or failed.");
    } finally {
      setSubmittingWallet(false);
    }
  };

  const selectedRail = CRYPTO_RAILS.find((r) => r.id === railId) || CRYPTO_RAILS[0];

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby="crypto-checkout-title"
      onClose={onClose}
      onMouseDown={(e) => {
        backdropDownRef.current = e.target === dialogRef.current;
      }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === dialogRef.current) {
          onClose();
        }
        backdropDownRef.current = false;
      }}
      className="m-auto w-[min(94vw,680px)] max-h-[90vh] overflow-y-auto rounded border border-[#cccccc] bg-white p-0 text-[#333333]"
    >
      {plan && (
        <div className="p-5 sm:p-6 space-y-5 bg-white">
          <div className="flex items-start justify-between gap-4 border-b border-[#cccccc] pb-4">
            <div>
              <h2 id="crypto-checkout-title" className="text-lg font-bold text-[#333333]">
                Pay via Crypto · {plan.name} (${plan.priceUsd}/mo)
              </h2>
              <p className="text-xs text-[#666666] mt-1">
                Direct zero-fee on-chain USDC settlement verified by JSON-RPC receipt logs — no middleman markup on ${plan.priceUsd} plans.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close checkout dialog"
              className="rounded border border-[#cccccc] bg-white px-2.5 py-1.5 text-xs text-[#666666] hover:font-bold hover:text-[#333333] inline-flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
              1. Choose Low-Fee Network
            </h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
              {CRYPTO_RAILS.map((rail) => {
                const active = rail.id === railId;
                return (
                  <button
                    key={rail.id}
                    type="button"
                    onClick={() => setRailId(rail.id)}
                    aria-pressed={active}
                    className={`text-left rounded border bg-white p-2.5 transition-colors ${
                      active
                        ? "border-[#333333] font-bold text-[#333333]"
                        : "border-[#cccccc] text-[#666666] hover:font-bold hover:text-[#333333]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className={active ? "font-bold text-[#333333]" : "text-[#333333]"}>
                        {rail.name}
                      </span>
                      {rail.recommended && (
                        <span className="text-[10px] border border-[#cccccc] px-1.5 py-0.5 text-[#666666]">
                          Lowest Fee
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#999999] mt-1 font-normal">
                      {rail.estimatedFee}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded border border-[#cccccc] bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
                2. Transfer Details
              </h3>
              <span className="text-xs font-bold text-[#333333]">
                {loadingQuote
                  ? "Calculating quote..."
                  : quoteData?.quote.amountDisplay || `${plan.priceUsd.toFixed(2)} ${selectedRail.tokenSymbol}`}
              </span>
            </div>

            {quoteData && !quoteData.configured ? (
              <div className="rounded border border-[#cccccc] bg-white p-3 text-xs text-[#666666] space-y-1">
                <div className="font-bold text-[#333333]">
                  Receiving Treasury Wallet Not Set on Server Yet
                </div>
                <p>
                  {quoteData.missingEnvHint} Add <code className="text-[#333333]">POLYPOST_TREASURY_EVM_ADDRESS</code>,{" "}
                  <code className="text-[#333333]">POLYPOST_TREASURY_SOL_ADDRESS</code>, and{" "}
                  <code className="text-[#333333]">ECOSYSTEM_LICENSE_SECRET</code> in Vercel Project Environment Variables so real payments route strictly to your own cold/hardware wallet.
                </p>
              </div>
            ) : (
              quoteData?.quote.recipient && (
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cccccc] pb-2">
                    <span className="text-[#666666]">Recipient Address:</span>
                    <div className="flex items-center gap-2 font-mono text-[#333333]">
                      <span className="break-all">{quoteData.quote.recipient}</span>
                      <button
                        type="button"
                        onClick={() => copyText("recipient", quoteData.quote.recipient || "")}
                        className="border border-[#cccccc] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] inline-flex items-center gap-1"
                      >
                        {copiedField === "recipient" ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedField === "recipient" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#999999]">
                    <span>Token Contract: {selectedRail.contractAddress}</span>
                    <span>Min confirmations: {selectedRail.requiredConfirmations}</span>
                  </div>
                </div>
              )
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {selectedRail.family === "evm" && (
                <button
                  type="button"
                  disabled={submittingWallet || loadingQuote || !quoteData?.configured}
                  onClick={handleWalletPay}
                  className="rounded border border-[#333333] bg-white px-3.5 py-2 text-xs font-bold text-[#333333] hover:font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  {submittingWallet
                    ? "Confirm in Wallet..."
                    : `Pay ${plan.priceUsd.toFixed(2)} USDC with Browser Wallet`}
                </button>
              )}

              <a
                href={
                  quoteData?.quote.fathomDashboardUrl ||
                  "https://crypto-dashboard-seven-lime.vercel.app"
                }
                target="_blank"
                rel="noreferrer"
                className="rounded border border-[#cccccc] bg-white px-3.5 py-2 text-xs text-[#666666] hover:font-bold hover:text-[#333333] inline-flex items-center gap-1.5"
              >
                Open Fathom Crypto Dashboard
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </section>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyHashOnServer(txHash);
            }}
            className="space-y-2.5"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#666666]">
              3. Verify On-Chain Transaction Hash & Mint License
            </h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder={
                  selectedRail.family === "solana"
                    ? "Paste Solana base58 signature..."
                    : "Paste 0x transaction hash..."
                }
                aria-label="Blockchain transaction hash or signature"
                className="flex-1 rounded border border-[#cccccc] bg-white px-3 py-2 text-xs font-mono text-[#333333]"
              />
              <button
                type="submit"
                disabled={verifying || !txHash.trim()}
                className="rounded border border-[#cccccc] bg-white px-4 py-2 text-xs font-bold text-[#333333] hover:font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {verifying ? "Verifying RPC..." : "Verify & Unlock"}
              </button>
            </div>
          </form>

          {statusMessage && (
            <div className="rounded border border-[#cccccc] bg-white p-3 text-xs text-[#333333]">
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div className="rounded border border-[#333333] bg-white p-3 text-xs font-bold text-[#333333]">
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

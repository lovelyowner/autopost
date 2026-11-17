import { NextRequest, NextResponse } from "next/server";
import {
  CRYPTO_RAILS,
  ECOSYSTEM_PROJECTS,
  PLAN_TIERS,
  buildFathomDashboardPayUrl,
  encodeErc20TransferCalldata,
  getPlanById,
  getRailById,
} from "@/lib/plans";
import {
  expectedBaseUnitsForPlan,
  getTreasuryStatus,
  resolveLicenseSecret,
  signEcosystemLicense,
  verifyCryptoPayment,
  verifyEcosystemLicense,
} from "@/lib/crypto-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  if (action !== "plans") {
    return NextResponse.json({ error: "Billing route not found" }, { status: 404 });
  }
  const treasury = getTreasuryStatus();
  return NextResponse.json(
    {
      plans: PLAN_TIERS,
      rails: CRYPTO_RAILS,
      ecosystemProjects: ECOSYSTEM_PROJECTS,
      treasury,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "quote") {
    const plan = getPlanById(String(body.planId || ""));
    const rail = getRailById(String(body.railId || "base_usdc"));
    if (!plan || plan.priceUsd <= 0) {
      return NextResponse.json(
        { error: "Select a paid plan (pro, vip, max, or extra)." },
        { status: 400 },
      );
    }
    if (!rail) {
      return NextResponse.json({ error: "Unsupported payment rail." }, { status: 400 });
    }

    const treasury = getTreasuryStatus();
    const recipient = rail.family === "solana" ? treasury.solanaAddress : treasury.evmAddress;
    const baseUnits = expectedBaseUnitsForPlan(plan.id, rail.id);
    const txParams =
      recipient && rail.family === "evm" && rail.chainId !== null
        ? {
            chainId: rail.chainId,
            chainIdHex: `0x${rail.chainId.toString(16)}`,
            to: rail.contractAddress,
            value: "0x0",
            data: encodeErc20TransferCalldata(recipient, baseUnits),
          }
        : null;

    return NextResponse.json(
      {
        configured: Boolean(recipient),
        missingEnvHint: recipient
          ? null
          : rail.family === "solana"
            ? "Set POLYPOST_TREASURY_SOL_ADDRESS to receive direct Solana USDC payments."
            : "Set POLYPOST_TREASURY_EVM_ADDRESS to receive direct Base/Arbitrum/Polygon USDC payments.",
        quote: {
          planId: plan.id,
          planName: plan.name,
          priceUsd: plan.priceUsd,
          railId: rail.id,
          railName: rail.name,
          chainId: rail.chainId,
          tokenSymbol: rail.tokenSymbol,
          tokenContract: rail.contractAddress,
          recipient,
          baseUnits,
          amountDisplay: `${plan.priceUsd.toFixed(2)} ${rail.tokenSymbol}`,
          estimatedFee: rail.estimatedFee,
          requiredConfirmations: rail.requiredConfirmations,
          txParams,
          fathomDashboardUrl: buildFathomDashboardPayUrl({
            planId: plan.id,
            railId: rail.id,
            amountUsd: plan.priceUsd,
            recipient: recipient ?? undefined,
          }),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (action === "verify") {
    const plan = getPlanById(String(body.planId || ""));
    const rail = getRailById(String(body.railId || "base_usdc"));
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    const connectedWallet =
      typeof body.connectedWallet === "string" ? body.connectedWallet.trim().toLowerCase() : "";

    if (!plan || plan.priceUsd <= 0 || !rail) {
      return NextResponse.json({ error: "Valid paid plan and payment rail required." }, { status: 400 });
    }
    if (!txHash) {
      return NextResponse.json({ error: "Transaction hash or signature is required." }, { status: 400 });
    }

    const treasury = getTreasuryStatus();
    const recipient = rail.family === "solana" ? treasury.solanaAddress : treasury.evmAddress;
    if (!recipient) {
      return NextResponse.json(
        {
          code: "TREASURY_NOT_CONFIGURED",
          error:
            rail.family === "solana"
              ? "Server treasury address missing: configure POLYPOST_TREASURY_SOL_ADDRESS."
              : "Server treasury address missing: configure POLYPOST_TREASURY_EVM_ADDRESS.",
        },
        { status: 503 },
      );
    }

    const secretState = resolveLicenseSecret();
    if (!secretState) {
      return NextResponse.json(
        {
          code: "LICENSE_SECRET_NOT_CONFIGURED",
          error:
            "Set ECOSYSTEM_LICENSE_SECRET (16+ characters) in deployment environment variables to sign verified ecosystem passes.",
        },
        { status: 503 },
      );
    }

    try {
      const result = await verifyCryptoPayment({
        railId: rail.id,
        txHash,
        expectedRecipient: recipient,
        expectedMinBaseUnits: expectedBaseUnitsForPlan(plan.id, rail.id),
      });

      if (result.status === "pending") {
        return NextResponse.json(result, { status: 202 });
      }
      if (result.status === "rejected") {
        return NextResponse.json({ status: "rejected", error: result.reason }, { status: 400 });
      }
      if (connectedWallet && result.payerAddress.toLowerCase() !== connectedWallet) {
        return NextResponse.json(
          {
            status: "rejected",
            error: `Sender address (${result.payerAddress}) does not match connected wallet (${connectedWallet}).`,
          },
          { status: 400 },
        );
      }

      const issued = signEcosystemLicense(
        {
          planId: plan.id,
          txHash: result.txHash,
          railId: rail.id,
          payerAddress: result.payerAddress,
        },
        secretState.secret,
      );

      return NextResponse.json(
        {
          status: "confirmed",
          verification: result,
          license: {
            token: issued.token,
            verifiedOnChain: true,
            ...issued.payload,
          },
          persistentSecret: secretState.persistent,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "RPC verification failed; retry shortly.",
        },
        { status: 502 },
      );
    }
  }

  if (action === "validate-license") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const secretState = resolveLicenseSecret();
    if (!secretState) {
      return NextResponse.json(
        { valid: false, reason: "License validation secret is not configured on this server." },
        { status: 503 },
      );
    }
    const check = verifyEcosystemLicense(token, secretState.secret);
    return NextResponse.json(check, {
      status: check.valid ? 200 : 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  return NextResponse.json({ error: "Billing route not found" }, { status: 404 });
}

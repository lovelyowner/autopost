import { NextRequest, NextResponse } from "next/server";
import { upsertRootEnvCredentials } from "@polypost/node-api-worker";
import {
  CRYPTO_RAILS,
  ECOSYSTEM_PROJECTS,
  PLAN_TIERS,
  buildFathomDashboardPayUrl,
  buildPaymentUri,
  encodeErc20TransferCalldata,
  formatTokenAmountDisplay,
  getPlanById,
  getRailById,
  isValidEvmAddress,
  isValidSolanaAddress,
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

const ALLOWED_ECOSYSTEM_ORIGINS = new Set([
  ...ECOSYSTEM_PROJECTS.map((p) => {
    try {
      return new URL(p.url).origin;
    } catch {
      return "";
    }
  }).filter(Boolean),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function buildBillingHeaders(req: NextRequest): Record<string, string> {
  const origin = (req.headers.get("origin") || "").trim();
  const allowOrigin =
    origin &&
    (ALLOWED_ECOSYSTEM_ORIGINS.has(origin) ||
      /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin))
      ? origin
      : "https://crypto-dashboard-seven-lime.vercel.app";

  return {
    "Cache-Control": "private, no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-PolyPost-License",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildBillingHeaders(req),
  });
}

export async function GET(req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  const headers = buildBillingHeaders(req);

  if (action === "plans") {
    const treasury = getTreasuryStatus();
    return NextResponse.json(
      {
        plans: PLAN_TIERS,
        rails: CRYPTO_RAILS,
        ecosystemProjects: ECOSYSTEM_PROJECTS,
        treasury,
      },
      { headers },
    );
  }

  if (action === "ecosystem-manifest") {
    const treasury = getTreasuryStatus();
    return NextResponse.json(
      {
        issuer: "polypost",
        version: 1,
        tokenPrefix: "pp_eco_v1",
        algorithm: "HMAC-SHA256",
        sharedSecretEnvVar: "ECOSYSTEM_LICENSE_SECRET",
        validateEndpoint: "/api/billing/validate-license",
        ecosystemProjects: ECOSYSTEM_PROJECTS,
        plans: PLAN_TIERS,
        treasuryConfigured: treasury.evmConfigured || treasury.solanaConfigured,
      },
      { headers },
    );
  }

  return NextResponse.json({ error: "Billing route not found" }, { status: 404, headers });
}

function resolveRecipientAddress(
  railFamily: "evm" | "solana",
  customRecipientRaw: unknown,
): {
  recipient: string | null;
  treasuryMode: "server_env" | "owner_configured" | null;
} {
  const treasury = getTreasuryStatus();
  const serverAddress = railFamily === "solana" ? treasury.solanaAddress : treasury.evmAddress;
  if (serverAddress) {
    return { recipient: serverAddress, treasuryMode: "server_env" };
  }
  const candidate = typeof customRecipientRaw === "string" ? customRecipientRaw.trim() : "";
  if (railFamily === "solana" && isValidSolanaAddress(candidate)) {
    return { recipient: candidate, treasuryMode: "owner_configured" };
  }
  if (railFamily === "evm" && isValidEvmAddress(candidate)) {
    return { recipient: candidate.toLowerCase(), treasuryMode: "owner_configured" };
  }
  return { recipient: null, treasuryMode: null };
}

export async function POST(req: NextRequest, context: Ctx) {
  const { action } = await context.params;
  const headers = buildBillingHeaders(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "configure-treasury") {
    const evmRaw = typeof body.evmAddress === "string" ? body.evmAddress.trim() : "";
    const solRaw = typeof body.solanaAddress === "string" ? body.solanaAddress.trim() : "";
    const secretRaw = typeof body.licenseSecret === "string" ? body.licenseSecret.trim() : "";

    if (evmRaw && !isValidEvmAddress(evmRaw)) {
      return NextResponse.json(
        { error: "Enter a valid 0x EVM wallet address (42 hex characters)." },
        { status: 400, headers },
      );
    }
    if (solRaw && !isValidSolanaAddress(solRaw)) {
      return NextResponse.json(
        { error: "Enter a valid Solana base58 wallet address." },
        { status: 400, headers },
      );
    }

    if (!process.env.VERCEL) {
      const updates: Record<string, string | null> = {};
      if (evmRaw) updates.POLYPOST_TREASURY_EVM_ADDRESS = evmRaw.toLowerCase();
      if (solRaw) updates.POLYPOST_TREASURY_SOL_ADDRESS = solRaw;
      if (secretRaw.length >= 16) updates.ECOSYSTEM_LICENSE_SECRET = secretRaw;
      upsertRootEnvCredentials(updates);
      if (evmRaw) process.env.POLYPOST_TREASURY_EVM_ADDRESS = evmRaw.toLowerCase();
      if (solRaw) process.env.POLYPOST_TREASURY_SOL_ADDRESS = solRaw;
      if (secretRaw.length >= 16) process.env.ECOSYSTEM_LICENSE_SECRET = secretRaw;
    }

    return NextResponse.json(
      {
        ok: true,
        persistedToServerEnv: !process.env.VERCEL,
        treasury: getTreasuryStatus(),
      },
      { headers },
    );
  }

  if (action === "quote") {
    const plan = getPlanById(String(body.planId || ""));
    const rail = getRailById(String(body.railId || "base_usdc"));
    if (!plan || plan.priceUsd <= 0) {
      return NextResponse.json(
        { error: "Select a paid plan (pro, vip, max, or extra)." },
        { status: 400, headers },
      );
    }
    if (!rail) {
      return NextResponse.json({ error: "Unsupported payment rail." }, { status: 400, headers });
    }

    const { recipient, treasuryMode } = resolveRecipientAddress(rail.family, body.customRecipient);
    const baseUnits = expectedBaseUnitsForPlan(plan.id, rail.id);
    const txParams =
      recipient && rail.family === "evm" && rail.chainId !== null
        ? rail.assetKind === "native"
          ? {
              chainId: rail.chainId,
              chainIdHex: `0x${rail.chainId.toString(16)}`,
              to: recipient,
              value: `0x${BigInt(baseUnits).toString(16)}`,
              data: "0x",
            }
          : {
              chainId: rail.chainId,
              chainIdHex: `0x${rail.chainId.toString(16)}`,
              to: rail.contractAddress,
              value: "0x0",
              data: encodeErc20TransferCalldata(recipient, baseUnits),
            }
        : null;

    const paymentUri = recipient
      ? buildPaymentUri({
          rail,
          recipient,
          baseUnits,
          priceUsd: plan.priceUsd,
        })
      : null;

    return NextResponse.json(
      {
        configured: Boolean(recipient),
        treasuryMode,
        missingEnvHint: recipient
          ? null
          : rail.family === "solana"
            ? "Set your receiving Solana address in Treasury Setup on /settings#plans (or POLYPOST_TREASURY_SOL_ADDRESS in env)."
            : "Set your receiving 0x EVM address in Treasury Setup on /settings#plans (or POLYPOST_TREASURY_EVM_ADDRESS in env).",
        quote: {
          planId: plan.id,
          planName: plan.name,
          priceUsd: plan.priceUsd,
          railId: rail.id,
          railName: rail.name,
          assetKind: rail.assetKind,
          chainId: rail.chainId,
          tokenSymbol: rail.tokenSymbol,
          tokenContract: rail.contractAddress,
          recipient,
          baseUnits,
          amountDisplay: formatTokenAmountDisplay(plan.priceUsd, rail),
          estimatedFee: rail.estimatedFee,
          requiredConfirmations: rail.requiredConfirmations,
          txParams,
          paymentUri,
          fathomDashboardUrl: buildFathomDashboardPayUrl({
            planId: plan.id,
            railId: rail.id,
            amountUsd: plan.priceUsd,
            recipient: recipient ?? undefined,
          }),
        },
      },
      { headers },
    );
  }

  if (action === "verify") {
    const plan = getPlanById(String(body.planId || ""));
    const rail = getRailById(String(body.railId || "base_usdc"));
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    const connectedWallet =
      typeof body.connectedWallet === "string" ? body.connectedWallet.trim().toLowerCase() : "";

    if (!plan || plan.priceUsd <= 0 || !rail) {
      return NextResponse.json(
        { error: "Valid paid plan and payment rail required." },
        { status: 400, headers },
      );
    }
    if (!txHash) {
      return NextResponse.json(
        { error: "Transaction hash or signature is required." },
        { status: 400, headers },
      );
    }

    const { recipient, treasuryMode } = resolveRecipientAddress(rail.family, body.customRecipient);
    if (!recipient || !treasuryMode) {
      return NextResponse.json(
        {
          code: "TREASURY_NOT_CONFIGURED",
          error:
            rail.family === "solana"
              ? "Server treasury address missing: configure POLYPOST_TREASURY_SOL_ADDRESS or set your Solana wallet in Treasury Setup."
              : "Server treasury address missing: configure POLYPOST_TREASURY_EVM_ADDRESS or set your 0x EVM wallet in Treasury Setup.",
        },
        { status: 503, headers },
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
        { status: 503, headers },
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
        return NextResponse.json(result, { status: 202, headers });
      }
      if (result.status === "rejected") {
        return NextResponse.json(
          { status: "rejected", error: result.reason },
          { status: 400, headers },
        );
      }
      if (connectedWallet && result.payerAddress.toLowerCase() !== connectedWallet) {
        return NextResponse.json(
          {
            status: "rejected",
            error: `Sender address (${result.payerAddress}) does not match connected wallet (${connectedWallet}).`,
          },
          { status: 400, headers },
        );
      }

      const issued = signEcosystemLicense(
        {
          planId: plan.id,
          txHash: result.txHash,
          railId: rail.id,
          payerAddress: result.payerAddress,
          recipientAddress: recipient,
          treasuryMode,
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
        { headers },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "RPC verification failed; retry shortly.",
        },
        { status: 502, headers },
      );
    }
  }

  if (action === "validate-license") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const secretState = resolveLicenseSecret();
    if (!secretState) {
      return NextResponse.json(
        { valid: false, reason: "License validation secret is not configured on this server." },
        { status: 503, headers },
      );
    }
    const check = verifyEcosystemLicense(token, secretState.secret);
    return NextResponse.json(check, {
      status: check.valid ? 200 : 401,
      headers,
    });
  }

  return NextResponse.json({ error: "Billing route not found" }, { status: 404, headers });
}

/** Server-only on-chain crypto payment verification (ERC-20, Native ETH, Solana SPL, NOWPayments IPN) & HMAC-SHA256 cross-app license tokens. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type CryptoRailId,
  type CryptoRailSpec,
  ECOSYSTEM_PROJECTS,
  type PlanId,
  getPlanById,
  getRailById,
  isValidEvmAddress,
  isValidSolanaAddress,
  usdToTokenBaseUnits,
} from "./plans";

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EVM_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_QTY_RE = /^0x[0-9a-fA-F]+$/;
const SOL_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const MAX_RPC_BYTES = 1024 * 1024;
const DEFAULT_LICENSE_DAYS = 30;

export interface CryptoVerificationRequest {
  railId: CryptoRailId;
  txHash: string;
  expectedRecipient: string;
  expectedMinBaseUnits: string;
  rpcUrlOverride?: string;
}

export type CryptoVerificationResult =
  | {
      status: "confirmed";
      txHash: string;
      railId: CryptoRailId;
      payerAddress: string;
      recipientAddress: string;
      transferredBaseUnits: string;
      confirmations: number;
      blockNumber: number;
    }
  | {
      status: "pending";
      confirmations: number;
      requiredConfirmations: number;
      reason: string;
    }
  | {
      status: "rejected";
      reason: string;
    };

export interface EcosystemLicensePayload {
  v: 1;
  planId: PlanId;
  planName: string;
  priceUsd: number;
  apps: string[];
  txHash: string;
  railId: CryptoRailId;
  payerAddress: string;
  recipientAddress?: string;
  treasuryMode?: "server_env" | "owner_configured";
  iat: number;
  exp: number;
}

export interface TreasuryStatus {
  evmAddress: string | null;
  solanaAddress: string | null;
  evmConfigured: boolean;
  solanaConfigured: boolean;
  nowpaymentsConfigured: boolean;
  licenseSigningConfigured: boolean;
}

let ephemeralLocalSecret: string | null = null;

export function getTreasuryStatus(): TreasuryStatus {
  const rawEvm = (
    process.env.POLYPOST_TREASURY_EVM_ADDRESS ||
    process.env.NEXT_PUBLIC_POLYPOST_TREASURY_EVM_ADDRESS ||
    ""
  ).trim();
  const rawSol = (
    process.env.POLYPOST_TREASURY_SOL_ADDRESS ||
    process.env.NEXT_PUBLIC_POLYPOST_TREASURY_SOL_ADDRESS ||
    ""
  ).trim();
  const evmAddress = isValidEvmAddress(rawEvm) ? rawEvm.toLowerCase() : null;
  const solanaAddress = isValidSolanaAddress(rawSol) ? rawSol : null;
  const envSecret = (
    process.env.ECOSYSTEM_LICENSE_SECRET ||
    process.env.POLYPOST_LICENSE_SECRET ||
    ""
  ).trim();

  return {
    evmAddress,
    solanaAddress,
    evmConfigured: Boolean(evmAddress),
    solanaConfigured: Boolean(solanaAddress),
    nowpaymentsConfigured: Boolean((process.env.NOWPAYMENTS_API_KEY || "").trim()),
    licenseSigningConfigured: envSecret.length >= 16,
  };
}

export function resolveLicenseSecret(): { secret: string; persistent: boolean } | null {
  const envSecret = (
    process.env.ECOSYSTEM_LICENSE_SECRET ||
    process.env.POLYPOST_LICENSE_SECRET ||
    ""
  ).trim();
  if (envSecret.length >= 16) {
    return { secret: envSecret, persistent: true };
  }
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  if (!ephemeralLocalSecret) {
    ephemeralLocalSecret = randomBytes(32).toString("hex");
  }
  return { secret: ephemeralLocalSecret, persistent: false };
}

async function callJsonRpc(
  url: string,
  method: string,
  params: unknown[],
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 8000, 20000));
  const res = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}`);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RPC_BYTES) {
    throw new Error("RPC response exceeded maximum size limit.");
  }
  const parsed = JSON.parse(text) as { jsonrpc?: unknown; error?: unknown; result?: unknown };
  if (parsed.jsonrpc !== "2.0" || parsed.error || !("result" in parsed)) {
    throw new Error("RPC node returned an error payload.");
  }
  return parsed.result;
}

function resolveRpcUrl(rail: CryptoRailSpec, override?: string): string {
  if (override) return override;
  if ((rail.id === "base_usdc" || rail.id === "base_eth") && process.env.BASE_RPC_URL) {
    return process.env.BASE_RPC_URL.trim();
  }
  if (
    (rail.id === "arbitrum_usdc" || rail.id === "arbitrum_usdt") &&
    process.env.ARBITRUM_RPC_URL
  ) {
    return process.env.ARBITRUM_RPC_URL.trim();
  }
  if (rail.id === "polygon_usdc" && process.env.POLYGON_RPC_URL) {
    return process.env.POLYGON_RPC_URL.trim();
  }
  if (rail.id === "ethereum_usdc" && process.env.ETHEREUM_PAYMENTS_RPC_URL) {
    return process.env.ETHEREUM_PAYMENTS_RPC_URL.trim();
  }
  if (rail.id === "solana_usdc" && process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL.trim();
  }
  return rail.defaultRpcUrl;
}

export async function verifyEvmUsdcPayment(
  req: CryptoVerificationRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CryptoVerificationResult> {
  const rail = getRailById(req.railId);
  if (!rail || rail.family !== "evm" || rail.chainId === null) {
    return { status: "rejected", reason: "Unsupported EVM payment rail." };
  }
  const txHash = req.txHash.trim().toLowerCase();
  if (!EVM_HASH_RE.test(txHash)) {
    return { status: "rejected", reason: "Enter a valid 0x EVM transaction hash (66 chars)." };
  }
  if (!isValidEvmAddress(req.expectedRecipient)) {
    return { status: "rejected", reason: "Treasury EVM wallet address is invalid." };
  }
  const expectedRecipient = req.expectedRecipient.trim().toLowerCase();
  const minUnits = BigInt(req.expectedMinBaseUnits);
  if (minUnits <= 0n) {
    return { status: "rejected", reason: "Payment amount must be greater than zero." };
  }

  const rpcUrl = resolveRpcUrl(rail, req.rpcUrlOverride);
  const isNative = rail.assetKind === "native";

  const [chainHex, receiptRaw, latestBlockHex, txRaw] = await Promise.all([
    callJsonRpc(rpcUrl, "eth_chainId", [], options),
    callJsonRpc(rpcUrl, "eth_getTransactionReceipt", [txHash], options),
    callJsonRpc(rpcUrl, "eth_blockNumber", [], options),
    isNative ? callJsonRpc(rpcUrl, "eth_getTransactionByHash", [txHash], options) : Promise.resolve(null),
  ]);

  if (
    typeof chainHex !== "string" ||
    !HEX_QTY_RE.test(chainHex) ||
    Number(BigInt(chainHex)) !== rail.chainId
  ) {
    return { status: "rejected", reason: `RPC endpoint chain mismatch for ${rail.name}.` };
  }

  if (receiptRaw === null || (isNative && txRaw === null)) {
    return {
      status: "pending",
      confirmations: 0,
      requiredConfirmations: rail.requiredConfirmations,
      reason: `Transaction is not confirmed in a ${rail.name} block yet.`,
    };
  }

  const receipt = receiptRaw as {
    status?: unknown;
    from?: unknown;
    to?: unknown;
    blockNumber?: unknown;
    transactionHash?: unknown;
    logs?: Array<{
      address?: unknown;
      topics?: unknown[];
      data?: unknown;
    }>;
  };

  if (
    typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== txHash
  ) {
    return { status: "rejected", reason: "Returned receipt hash does not match request." };
  }

  if (typeof receipt.status !== "string" || !HEX_QTY_RE.test(receipt.status)) {
    return { status: "rejected", reason: "Missing EVM receipt execution status." };
  }
  if (BigInt(receipt.status) === 0n) {
    return { status: "rejected", reason: "This transaction reverted on-chain (status 0x0)." };
  }

  let matchedUnits = 0n;
  let matchedFrom = typeof receipt.from === "string" ? receipt.from.toLowerCase() : "";

  if (isNative) {
    const tx = (txRaw ?? {}) as { to?: unknown; from?: unknown; value?: unknown };
    const txTo = typeof tx.to === "string" ? tx.to.toLowerCase() : "";
    if (txTo !== expectedRecipient) {
      return {
        status: "rejected",
        reason: `Native ETH transfer recipient (${txTo || "contract"}) does not match ${expectedRecipient}.`,
      };
    }
    if (typeof tx.value !== "string" || !HEX_QTY_RE.test(tx.value)) {
      return { status: "rejected", reason: "Missing native ETH transaction value." };
    }
    matchedUnits = BigInt(tx.value);
    if (typeof tx.from === "string") {
      matchedFrom = tx.from.toLowerCase();
    }
  } else {
    const expectedContract = rail.contractAddress.toLowerCase();
    for (const log of receipt.logs ?? []) {
      if (
        typeof log.address !== "string" ||
        log.address.toLowerCase() !== expectedContract ||
        !Array.isArray(log.topics) ||
        log.topics.length < 3 ||
        typeof log.topics[0] !== "string" ||
        log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC ||
        typeof log.topics[1] !== "string" ||
        typeof log.topics[2] !== "string" ||
        typeof log.data !== "string" ||
        !HEX_QTY_RE.test(log.data)
      ) {
        continue;
      }
      const logTo = `0x${log.topics[2].slice(-40).toLowerCase()}`;
      if (logTo !== expectedRecipient) continue;
      matchedUnits += BigInt(log.data);
      matchedFrom = `0x${log.topics[1].slice(-40).toLowerCase()}`;
    }
  }

  if (matchedUnits === 0n) {
    return {
      status: "rejected",
      reason: `No ${rail.tokenSymbol} transfer to ${expectedRecipient} found on ${rail.name}.`,
    };
  }
  if (matchedUnits < minUnits) {
    return {
      status: "rejected",
      reason: `Transferred ${rail.tokenSymbol} base units (${matchedUnits.toString()}) is less than required (${minUnits.toString()}).`,
    };
  }

  if (
    typeof receipt.blockNumber !== "string" ||
    !HEX_QTY_RE.test(receipt.blockNumber) ||
    typeof latestBlockHex !== "string" ||
    !HEX_QTY_RE.test(latestBlockHex)
  ) {
    return { status: "rejected", reason: "Missing block number information from RPC." };
  }

  const includedBlock = BigInt(receipt.blockNumber);
  const latestBlock = BigInt(latestBlockHex);
  const confirmations = latestBlock >= includedBlock ? Number(latestBlock - includedBlock + 1n) : 0;

  if (confirmations < rail.requiredConfirmations) {
    return {
      status: "pending",
      confirmations,
      requiredConfirmations: rail.requiredConfirmations,
      reason: `Waiting for ${rail.requiredConfirmations} block confirmations (${confirmations}/${rail.requiredConfirmations}).`,
    };
  }

  return {
    status: "confirmed",
    txHash,
    railId: rail.id,
    payerAddress: matchedFrom || "unknown",
    recipientAddress: expectedRecipient,
    transferredBaseUnits: matchedUnits.toString(),
    confirmations,
    blockNumber: Number(includedBlock),
  };
}

export const verifyEvmPayment = verifyEvmUsdcPayment;

export async function verifySolanaUsdcPayment(
  req: CryptoVerificationRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CryptoVerificationResult> {
  const rail = getRailById("solana_usdc");
  if (!rail) {
    return { status: "rejected", reason: "Solana rail unavailable." };
  }
  const sig = req.txHash.trim();
  if (!SOL_SIG_RE.test(sig)) {
    return { status: "rejected", reason: "Enter a valid Solana base58 transaction signature." };
  }
  if (!isValidSolanaAddress(req.expectedRecipient)) {
    return { status: "rejected", reason: "Treasury Solana address is invalid." };
  }

  const rpcUrl = resolveRpcUrl(rail, req.rpcUrlOverride);
  const resultRaw = await callJsonRpc(
    rpcUrl,
    "getTransaction",
    [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
    options,
  );

  if (resultRaw === null) {
    return {
      status: "pending",
      confirmations: 0,
      requiredConfirmations: 1,
      reason: "Solana transaction not confirmed yet. Retry in a few seconds.",
    };
  }

  const txResult = resultRaw as {
    slot?: number;
    meta?: {
      err?: unknown;
      preTokenBalances?: Array<{
        accountIndex: number;
        mint?: string;
        owner?: string;
        uiTokenAmount?: { amount?: string };
      }>;
      postTokenBalances?: Array<{
        accountIndex: number;
        mint?: string;
        owner?: string;
        uiTokenAmount?: { amount?: string };
      }>;
    };
    transaction?: {
      message?: {
        accountKeys?: Array<{ pubkey?: string } | string>;
      };
    };
  };

  if (txResult.meta?.err) {
    return { status: "rejected", reason: "This Solana transaction failed on-chain." };
  }

  const preByIndex = new Map<number, bigint>();
  for (const row of txResult.meta?.preTokenBalances ?? []) {
    if (row.mint === rail.contractAddress && row.owner === req.expectedRecipient) {
      preByIndex.set(row.accountIndex, BigInt(row.uiTokenAmount?.amount || "0"));
    }
  }

  let deltaUnits = 0n;
  for (const row of txResult.meta?.postTokenBalances ?? []) {
    if (row.mint === rail.contractAddress && row.owner === req.expectedRecipient) {
      const post = BigInt(row.uiTokenAmount?.amount || "0");
      const pre = preByIndex.get(row.accountIndex) ?? 0n;
      if (post > pre) {
        deltaUnits += post - pre;
      }
    }
  }

  const minUnits = BigInt(req.expectedMinBaseUnits);
  if (deltaUnits <= 0n) {
    return {
      status: "rejected",
      reason: `No USDC SPL balance increase found for ${req.expectedRecipient}.`,
    };
  }
  if (deltaUnits < minUnits) {
    return {
      status: "rejected",
      reason: `Solana USDC received (${deltaUnits.toString()}) is below required (${minUnits.toString()}).`,
    };
  }

  const firstKey = txResult.transaction?.message?.accountKeys?.[0];
  const payerAddress =
    typeof firstKey === "string" ? firstKey : firstKey?.pubkey || "solana-signer";

  return {
    status: "confirmed",
    txHash: sig,
    railId: "solana_usdc",
    payerAddress,
    recipientAddress: req.expectedRecipient,
    transferredBaseUnits: deltaUnits.toString(),
    confirmations: 1,
    blockNumber: Number(txResult.slot ?? 0),
  };
}

export async function verifyCryptoPayment(
  req: CryptoVerificationRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CryptoVerificationResult> {
  const rail = getRailById(req.railId);
  if (!rail) {
    return { status: "rejected", reason: "Unknown crypto payment rail." };
  }
  if (rail.family === "solana") {
    return verifySolanaUsdcPayment(req, options);
  }
  return verifyEvmUsdcPayment(req, options);
}

export function expectedBaseUnitsForPlan(planId: PlanId, railId: CryptoRailId): string {
  const plan = getPlanById(planId);
  const rail = getRailById(railId);
  if (!plan || !rail || plan.priceUsd <= 0) {
    throw new Error("Paid plan and crypto rail required.");
  }
  return usdToTokenBaseUnits(plan.priceUsd, rail.decimals, rail.tokenSymbol);
}

function sortedJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 30) throw new Error("IPN payload nesting is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => sortedJsonValue(entry, depth + 1));
  if (value && typeof value === "object") {
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortedJsonValue((value as Record<string, unknown>)[key], depth + 1);
    }
    return sorted;
  }
  throw new Error("IPN payload must contain only JSON values");
}

/** Verifies NOWPayments HMAC-SHA512 webhook signature over recursively key-sorted JSON (matches crypto-dashboard). */
export function verifyNowPaymentsIpnSignature(
  body: unknown,
  signature: string | null | undefined,
  ipnSecret: string,
): boolean {
  try {
    if (
      typeof signature !== "string" ||
      !/^[a-fA-F0-9]{128}$/.test(signature) ||
      !ipnSecret ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return false;
    }
    const canonical = JSON.stringify(sortedJsonValue(body));
    if (Buffer.byteLength(canonical, "utf8") > MAX_RPC_BYTES) return false;
    const expected = createHmac("sha512", ipnSecret).update(canonical, "utf8").digest();
    return timingSafeEqual(expected, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function signEcosystemLicense(
  params: {
    planId: PlanId;
    txHash: string;
    railId: CryptoRailId;
    payerAddress: string;
    recipientAddress?: string;
    treasuryMode?: "server_env" | "owner_configured";
    nowMs?: number;
    durationDays?: number;
  },
  secret: string,
): { token: string; payload: EcosystemLicensePayload } {
  const plan = getPlanById(params.planId);
  if (!plan || plan.priceUsd <= 0) {
    throw new Error("Cannot issue license token for free or unknown plan.");
  }
  if (!secret || secret.length < 16) {
    throw new Error("License signing secret must be at least 16 characters.");
  }
  const nowMs = params.nowMs ?? Date.now();
  const durationDays = params.durationDays ?? DEFAULT_LICENSE_DAYS;
  const payload: EcosystemLicensePayload = {
    v: 1,
    planId: plan.id,
    planName: plan.name,
    priceUsd: plan.priceUsd,
    apps: plan.includesEcosystemMax ? ECOSYSTEM_PROJECTS.map((p) => p.id) : ["autopost"],
    txHash: params.txHash,
    railId: params.railId,
    payerAddress: params.payerAddress,
    ...(params.recipientAddress ? { recipientAddress: params.recipientAddress } : {}),
    ...(params.treasuryMode ? { treasuryMode: params.treasuryMode } : {}),
    iat: nowMs,
    exp: nowMs + durationDays * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  return {
    token: `pp_eco_v1.${encoded}.${sig}`,
    payload,
  };
}

export function verifyEcosystemLicense(
  token: string,
  secret: string,
  nowMs = Date.now(),
): { valid: true; payload: EcosystemLicensePayload } | { valid: false; reason: string } {
  if (!token || !secret) {
    return { valid: false, reason: "Missing token or verification secret." };
  }
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "pp_eco_v1") {
    return { valid: false, reason: "Malformed license token format." };
  }
  const [, encoded, sig] = parts;
  const expectedSig = createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: "Invalid license signature." };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as EcosystemLicensePayload;
    if (payload.v !== 1 || typeof payload.exp !== "number" || !Array.isArray(payload.apps)) {
      return { valid: false, reason: "Invalid license claims." };
    }
    if (nowMs > payload.exp) {
      return { valid: false, reason: "License token expired." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "Could not decode license payload." };
  }
}

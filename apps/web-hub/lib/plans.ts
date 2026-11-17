/** Browser-safe plan catalog, crypto rail specs, ERC-20 calldata builder, and local license helpers. */

export type PlanId = "free" | "pro" | "vip" | "max" | "extra";

export type CryptoRailId =
  | "base_usdc"
  | "arbitrum_usdc"
  | "polygon_usdc"
  | "solana_usdc"
  | "ethereum_usdc";

export interface EcosystemProject {
  id: string;
  name: string;
  url: string;
  tierGranted: string;
  summary: string;
}

export interface PlanTier {
  id: PlanId;
  name: string;
  priceUsd: number;
  billingCycle: string;
  badge?: string;
  accountsPerPlatformCap: number | "unlimited";
  dailyRunsLimit: number | "unlimited";
  summary: string;
  features: string[];
  includesEcosystemMax: boolean;
}

export interface CryptoRailSpec {
  id: CryptoRailId;
  name: string;
  family: "evm" | "solana";
  chainId: number | null;
  tokenSymbol: "USDC";
  decimals: number;
  contractAddress: string;
  estimatedFee: string;
  requiredConfirmations: number;
  explorerTxBaseUrl: string;
  defaultRpcUrl: string;
  recommended?: boolean;
}

export interface StoredLicenseState {
  token: string;
  planId: PlanId;
  planName: string;
  priceUsd: number;
  apps: string[];
  txHash: string;
  railId: CryptoRailId;
  payerAddress: string;
  issuedAt: number;
  expiresAt: number;
  verifiedOnChain: boolean;
}

export const LICENSE_STORAGE_KEY = "polypost_ecosystem_license_v1";
export const LICENSE_CHANGED_EVENT = "polypost:license-changed";

export const FATHOM_CRYPTO_DASHBOARD_URL = "https://crypto-dashboard-seven-lime.vercel.app";

export const ECOSYSTEM_PROJECTS: EcosystemProject[] = [
  {
    id: "autopost",
    name: "PolyPost",
    url: "https://autopost-gilt-gamma.vercel.app",
    tierGranted: "Max Tier",
    summary: "125+ platform stealth + API autoposting hub & funnel scheduler.",
  },
  {
    id: "crypto-dashboard",
    name: "Fathom Crypto Dashboard",
    url: "https://crypto-dashboard-seven-lime.vercel.app",
    tierGranted: "Max Tier",
    summary: "Self-custody multi-chain wallet portfolio, ETH/NOWPayments & commerce inbox.",
  },
  {
    id: "phoenixchat",
    name: "PhoenixChat",
    url: "https://phoenixchat-ten.vercel.app",
    tierGranted: "Max Tier",
    summary: "Rust-powered real-time messaging & community workspaces.",
  },
  {
    id: "fedipress-buzz",
    name: "Fedipress Buzz",
    url: "https://fedipress-buzz.vercel.app",
    tierGranted: "Max Tier",
    summary: "Fediverse & decentralized social publishing suite.",
  },
  {
    id: "voice",
    name: "Voice",
    url: "https://voice-ten-wine.vercel.app",
    tierGranted: "Max Tier",
    summary: "Real-time voice & audio workflows.",
  },
  {
    id: "voicestudio",
    name: "VoiceStudio",
    url: "https://voicestudio.sh",
    tierGranted: "Max Tier",
    summary: "Creator voice synthesis and studio audio production.",
  },
];

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    billingCycle: "/mo",
    accountsPerPlatformCap: 1,
    dailyRunsLimit: 5,
    summary: "Local companion + BYO API keys for single-account testing.",
    features: [
      "1 connected account per platform",
      "Up to 5 campaign launches / day",
      "Local Chromium stealth login + Cookie JSON import",
      "A–Z platform filter & basic proxy health check",
    ],
    includesEcosystemMax: false,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 3,
    billingCycle: "/mo",
    accountsPerPlatformCap: 3,
    dailyRunsLimit: 30,
    summary: "Ideal safe starter tier for 1–3 accounts across your main networks.",
    features: [
      "Up to 3 accounts per platform (recommended starter cap)",
      "Up to 30 teaser/master dispatches per day",
      "Spintax caption uniqueness + staggered delay rules",
      "Multi-account proxy collision detector",
    ],
    includesEcosystemMax: false,
  },
  {
    id: "vip",
    name: "VIP",
    priceUsd: 5,
    billingCycle: "/mo",
    accountsPerPlatformCap: 5,
    dailyRunsLimit: 120,
    summary: "Creator growth tier with CSV calendar scheduling & FFmpeg deduplication.",
    features: [
      "Up to 5 accounts per platform with per-account proxy binding",
      "Up to 120 daily dispatches + bulk CSV calendar queue",
      "FFmpeg perceptual re-encoding & PNG watermark presets",
      "24h sliding post counter per Vault profile",
    ],
    includesEcosystemMax: false,
  },
  {
    id: "max",
    name: "Max",
    priceUsd: 8,
    billingCycle: "/mo",
    accountsPerPlatformCap: "unlimited",
    dailyRunsLimit: "unlimited",
    summary: "Full PolyPost agency power across all 125+ platforms & funnels.",
    features: [
      "Unlimited accounts (safe platform cap warnings active)",
      "Unlimited funnel launches & parallel Chromium workers",
      "Full MCP server + headless API orchestration",
      "Priority preset sync across local & cloud deployments",
    ],
    includesEcosystemMax: false,
  },
  {
    id: "extra",
    name: "Extra",
    priceUsd: 10,
    billingCycle: "/mo",
    badge: "All-Projects Pass",
    accountsPerPlatformCap: "unlimited",
    dailyRunsLimit: "unlimited",
    summary: "PolyPost Max PLUS Max Tier unlocked across every connected ecosystem project.",
    features: [
      "Full PolyPost Max Tier ($8 value)",
      "Max Tier on Fathom Crypto Dashboard & PhoenixChat",
      "Max Tier on Fedipress Buzz, Voice & VoiceStudio",
      "Single cryptographic pp_eco_v1 cross-app license token",
    ],
    includesEcosystemMax: true,
  },
];

export const CRYPTO_RAILS: CryptoRailSpec[] = [
  {
    id: "base_usdc",
    name: "Base · USDC",
    family: "evm",
    chainId: 8453,
    tokenSymbol: "USDC",
    decimals: 6,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    estimatedFee: "~$0.002 gas · 0% gateway fee",
    requiredConfirmations: 3,
    explorerTxBaseUrl: "https://basescan.org/tx/",
    defaultRpcUrl: "https://mainnet.base.org",
    recommended: true,
  },
  {
    id: "arbitrum_usdc",
    name: "Arbitrum · USDC",
    family: "evm",
    chainId: 42161,
    tokenSymbol: "USDC",
    decimals: 6,
    contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    estimatedFee: "~$0.005 gas · 0% gateway fee",
    requiredConfirmations: 3,
    explorerTxBaseUrl: "https://arbiscan.io/tx/",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
  },
  {
    id: "polygon_usdc",
    name: "Polygon · USDC",
    family: "evm",
    chainId: 137,
    tokenSymbol: "USDC",
    decimals: 6,
    contractAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    estimatedFee: "~$0.003 gas · 0% gateway fee",
    requiredConfirmations: 5,
    explorerTxBaseUrl: "https://polygonscan.com/tx/",
    defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com",
  },
  {
    id: "solana_usdc",
    name: "Solana · USDC",
    family: "solana",
    chainId: null,
    tokenSymbol: "USDC",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    estimatedFee: "~$0.0005 gas · 0% gateway fee",
    requiredConfirmations: 1,
    explorerTxBaseUrl: "https://solscan.io/tx/",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
  },
  {
    id: "ethereum_usdc",
    name: "Ethereum L1 · USDC",
    family: "evm",
    chainId: 1,
    tokenSymbol: "USDC",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    estimatedFee: "~$1–$5 gas · not ideal for $3–$10 plans",
    requiredConfirmations: 3,
    explorerTxBaseUrl: "https://etherscan.io/tx/",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
  },
];

export function getPlanById(id: string): PlanTier | undefined {
  return PLAN_TIERS.find((p) => p.id === id);
}

export function getRailById(id: string): CryptoRailSpec | undefined {
  return CRYPTO_RAILS.find((r) => r.id === id);
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim()) && !/^0x0{40}$/i.test(address.trim());
}

export function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
}

export function usdToTokenBaseUnits(usdAmount: number, decimals = 6): string {
  if (!Number.isFinite(usdAmount) || usdAmount < 0) return "0";
  const cents = BigInt(Math.round(usdAmount * 100));
  const scale = 10n ** BigInt(Math.max(0, decimals - 2));
  return (cents * scale).toString();
}

/** Encodes ERC-20 `transfer(address,uint256)` calldata without external dependencies. */
export function encodeErc20TransferCalldata(recipient: string, baseUnits: string | bigint): string {
  const cleanRecipient = recipient.trim().toLowerCase();
  if (!isValidEvmAddress(cleanRecipient)) {
    throw new Error("Invalid EVM recipient address for ERC-20 transfer encoding.");
  }
  const amount = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  if (amount <= 0n) {
    throw new Error("Transfer amount must be positive.");
  }
  const selector = "a9059cbb";
  const addrWord = cleanRecipient.slice(2).padStart(64, "0");
  const amtWord = amount.toString(16).padStart(64, "0");
  if (amtWord.length > 64) {
    throw new Error("Transfer amount overflows uint256.");
  }
  return `0x${selector}${addrWord}${amtWord}`;
}

export function buildFathomDashboardPayUrl(params: {
  planId: PlanId;
  railId: CryptoRailId;
  amountUsd: number;
  recipient?: string;
}): string {
  const url = new URL(FATHOM_CRYPTO_DASHBOARD_URL);
  url.searchParams.set("source", "polypost");
  url.searchParams.set("plan", params.planId);
  url.searchParams.set("rail", params.railId);
  url.searchParams.set("amountUsd", String(params.amountUsd));
  if (params.recipient) {
    url.searchParams.set("to", params.recipient);
  }
  return url.toString();
}

export function getClientPlanLicense(): StoredLicenseState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LICENSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLicenseState;
    if (!parsed || typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveClientPlanLicense(license: StoredLicenseState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(license));
    window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearClientPlanLicense(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LICENSE_STORAGE_KEY);
    window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT));
  } catch {
    // Ignore
  }
}

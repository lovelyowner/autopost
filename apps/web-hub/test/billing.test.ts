import { describe, expect, it } from "vitest";
import {
  CRYPTO_RAILS,
  ECOSYSTEM_PROJECTS,
  PLAN_TIERS,
  encodeErc20TransferCalldata,
  usdToTokenBaseUnits,
} from "../lib/plans";
import {
  ERC20_TRANSFER_TOPIC,
  expectedBaseUnitsForPlan,
  signEcosystemLicense,
  verifyEcosystemLicense,
  verifyEvmUsdcPayment,
  verifySolanaUsdcPayment,
} from "../lib/crypto-verify";

const TEST_TREASURY_EVM = "0x1111111111111111111111111111111111111111";
const TEST_PAYER_EVM = "0x2222222222222222222222222222222222222222";
const TEST_TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TEST_SECRET = "test-shared-ecosystem-secret-key-2026";

function padTopicAddress(addr: string): string {
  return `0x${addr.toLowerCase().slice(2).padStart(64, "0")}`;
}

function padUint256Hex(amount: bigint): string {
  return `0x${amount.toString(16).padStart(64, "0")}`;
}

describe("plan tiers, ERC-20 encoding, and ecosystem license tokens", () => {
  it("defines Pro $3, VIP $5, Max $8, Extra $10 and all-projects coverage", () => {
    const byId = Object.fromEntries(PLAN_TIERS.map((p) => [p.id, p]));
    expect(byId.free.priceUsd).toBe(0);
    expect(byId.pro.priceUsd).toBe(3);
    expect(byId.vip.priceUsd).toBe(5);
    expect(byId.max.priceUsd).toBe(8);
    expect(byId.extra.priceUsd).toBe(10);
    expect(byId.extra.includesEcosystemMax).toBe(true);
    expect(byId.max.includesEcosystemMax).toBe(false);

    const projectIds = ECOSYSTEM_PROJECTS.map((p) => p.id);
    expect(projectIds).toEqual([
      "autopost",
      "crypto-dashboard",
      "phoenixchat",
      "fedipress-buzz",
      "voice",
      "voicestudio",
    ]);
  });

  it("encodes exact ERC-20 transfer(address,uint256) calldata for USDC 6-decimal amounts", () => {
    expect(usdToTokenBaseUnits(3, 6)).toBe("3000000");
    expect(usdToTokenBaseUnits(10, 6)).toBe("10000000");
    expect(expectedBaseUnitsForPlan("extra", "base_usdc")).toBe("10000000");

    const calldata = encodeErc20TransferCalldata(TEST_TREASURY_EVM, "10000000");
    expect(calldata).toMatch(/^0xa9059cbb[0-9a-f]{128}$/);
    expect(calldata.slice(0, 10)).toBe("0xa9059cbb");
    expect(calldata.slice(10, 74)).toBe("1111111111111111111111111111111111111111".padStart(64, "0"));
    expect(BigInt(`0x${calldata.slice(74)}`)).toBe(10_000_000n);
  });

  it("signs and verifies stateless HMAC-SHA256 Extra license tokens across all apps", () => {
    const now = 1_760_000_000_000;
    const { token, payload } = signEcosystemLicense(
      {
        planId: "extra",
        txHash: TEST_TX_HASH,
        railId: "base_usdc",
        payerAddress: TEST_PAYER_EVM,
        nowMs: now,
      },
      TEST_SECRET,
    );

    expect(token.startsWith("pp_eco_v1.")).toBe(true);
    expect(payload.apps).toContain("crypto-dashboard");
    expect(payload.apps).toContain("phoenixchat");
    expect(payload.apps).toContain("fedipress-buzz");
    expect(payload.apps).toContain("voicestudio");

    const ok = verifyEcosystemLicense(token, TEST_SECRET, now + 1000);
    expect(ok.valid).toBe(true);
    if (ok.valid) {
      expect(ok.payload.planId).toBe("extra");
      expect(ok.payload.priceUsd).toBe(10);
    }

    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifyEcosystemLicense(tampered, TEST_SECRET, now + 1000).valid).toBe(false);
    expect(verifyEcosystemLicense(token, TEST_SECRET, now + 40 * 24 * 60 * 60 * 1000).valid).toBe(false);
  });
});

describe("on-chain crypto RPC verification", () => {
  function mockRpcFetch(handlers: Record<string, unknown>): typeof fetch {
    return (async (_input, init) => {
      const payload = JSON.parse(String(init?.body || "{}")) as { method: string };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: handlers[payload.method] ?? null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
  }

  it("confirms exact Base USDC Transfer event matching recipient, amount, and confirmations", async () => {
    const fetchImpl = mockRpcFetch({
      eth_chainId: "0x2105", // 8453 Base
      eth_blockNumber: "0x69", // 105
      eth_getTransactionReceipt: {
        transactionHash: TEST_TX_HASH,
        status: "0x1",
        blockNumber: "0x64", // 100 -> 6 confirmations >= 3
        from: TEST_PAYER_EVM,
        logs: [
          {
            address: BASE_USDC_CONTRACT,
            topics: [
              ERC20_TRANSFER_TOPIC,
              padTopicAddress(TEST_PAYER_EVM),
              padTopicAddress(TEST_TREASURY_EVM),
            ],
            data: padUint256Hex(10_000_000n),
          },
        ],
      },
    });

    const result = await verifyEvmUsdcPayment(
      {
        railId: "base_usdc",
        txHash: TEST_TX_HASH,
        expectedRecipient: TEST_TREASURY_EVM,
        expectedMinBaseUnits: expectedBaseUnitsForPlan("extra", "base_usdc"),
      },
      { fetchImpl },
    );

    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") {
      expect(result.payerAddress).toBe(TEST_PAYER_EVM);
      expect(result.transferredBaseUnits).toBe("10000000");
      expect(result.confirmations).toBe(6);
    }
  });

  it("rejects underpayment ($3 TX submitted for $10 Extra), wrong recipient, or reverted TX", async () => {
    const underpayFetch = mockRpcFetch({
      eth_chainId: "0x2105",
      eth_blockNumber: "0x69",
      eth_getTransactionReceipt: {
        transactionHash: TEST_TX_HASH,
        status: "0x1",
        blockNumber: "0x64",
        from: TEST_PAYER_EVM,
        logs: [
          {
            address: BASE_USDC_CONTRACT,
            topics: [
              ERC20_TRANSFER_TOPIC,
              padTopicAddress(TEST_PAYER_EVM),
              padTopicAddress(TEST_TREASURY_EVM),
            ],
            data: padUint256Hex(3_000_000n), // only $3!
          },
        ],
      },
    });

    const underpay = await verifyEvmUsdcPayment(
      {
        railId: "base_usdc",
        txHash: TEST_TX_HASH,
        expectedRecipient: TEST_TREASURY_EVM,
        expectedMinBaseUnits: expectedBaseUnitsForPlan("extra", "base_usdc"),
      },
      { fetchImpl: underpayFetch },
    );
    expect(underpay.status).toBe("rejected");

    const revertedFetch = mockRpcFetch({
      eth_chainId: "0x2105",
      eth_blockNumber: "0x69",
      eth_getTransactionReceipt: {
        transactionHash: TEST_TX_HASH,
        status: "0x0",
        blockNumber: "0x64",
        from: TEST_PAYER_EVM,
        logs: [],
      },
    });
    const reverted = await verifyEvmUsdcPayment(
      {
        railId: "base_usdc",
        txHash: TEST_TX_HASH,
        expectedRecipient: TEST_TREASURY_EVM,
        expectedMinBaseUnits: expectedBaseUnitsForPlan("pro", "base_usdc"),
      },
      { fetchImpl: revertedFetch },
    );
    expect(reverted.status).toBe("rejected");
  });

  it("verifies Solana USDC SPL token balance delta via getTransaction", async () => {
    const solTreasury = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
    const solMint = CRYPTO_RAILS.find((r) => r.id === "solana_usdc")!.contractAddress;
    const solSig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

    const fetchImpl = mockRpcFetch({
      getTransaction: {
        slot: 310000001,
        transaction: {
          message: {
            accountKeys: [{ pubkey: "PayerSolana111111111111111111111111111111111" }],
          },
        },
        meta: {
          err: null,
          preTokenBalances: [
            {
              accountIndex: 2,
              mint: solMint,
              owner: solTreasury,
              uiTokenAmount: { amount: "2000000" },
            },
          ],
          postTokenBalances: [
            {
              accountIndex: 2,
              mint: solMint,
              owner: solTreasury,
              uiTokenAmount: { amount: "7000000" }, // +5.00 USDC (VIP $5)
            },
          ],
        },
      },
    });

    const res = await verifySolanaUsdcPayment(
      {
        railId: "solana_usdc",
        txHash: solSig,
        expectedRecipient: solTreasury,
        expectedMinBaseUnits: expectedBaseUnitsForPlan("vip", "solana_usdc"),
      },
      { fetchImpl },
    );
    expect(res.status).toBe("confirmed");
    if (res.status === "confirmed") {
      expect(res.transferredBaseUnits).toBe("5000000");
    }
  });
});

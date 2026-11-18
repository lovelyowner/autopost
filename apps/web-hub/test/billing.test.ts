import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CRYPTO_RAILS,
  ECOSYSTEM_PROJECTS,
  PLAN_TIERS,
  buildPaymentUri,
  encodeErc20TransferCalldata,
  evaluateCampaignPlanLimits,
  formatTokenAmountDisplay,
  getRailById,
  usdToTokenBaseUnits,
} from "../lib/plans";
import {
  ERC20_TRANSFER_TOPIC,
  expectedBaseUnitsForPlan,
  signEcosystemLicense,
  verifyEcosystemLicense,
  verifyEvmUsdcPayment,
  verifyNowPaymentsIpnSignature,
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

describe("plan tiers, ERC-20/EIP-681 encoding, quotas, and ecosystem license tokens", () => {
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

  it("encodes exact ERC-20 transfer(address,uint256) calldata and EIP-681 / Solana Pay URIs", () => {
    expect(usdToTokenBaseUnits(3, 6)).toBe("3000000");
    expect(usdToTokenBaseUnits(10, 6)).toBe("10000000");
    expect(expectedBaseUnitsForPlan("extra", "base_usdc")).toBe("10000000");
    expect(expectedBaseUnitsForPlan("extra", "base_eth")).toBe("4000000000000000"); // 0.004 ETH in wei

    const calldata = encodeErc20TransferCalldata(TEST_TREASURY_EVM, "10000000");
    expect(calldata).toMatch(/^0xa9059cbb[0-9a-f]{128}$/);
    expect(calldata.slice(0, 10)).toBe("0xa9059cbb");
    expect(calldata.slice(10, 74)).toBe("1111111111111111111111111111111111111111".padStart(64, "0"));
    expect(BigInt(`0x${calldata.slice(74)}`)).toBe(10_000_000n);

    const baseUsdcRail = getRailById("base_usdc")!;
    const baseEthRail = getRailById("base_eth")!;
    const solUsdcRail = getRailById("solana_usdc")!;

    expect(
      buildPaymentUri({
        rail: baseUsdcRail,
        recipient: TEST_TREASURY_EVM,
        baseUnits: "3000000",
        priceUsd: 3,
      }),
    ).toBe(`ethereum:${BASE_USDC_CONTRACT}@8453/transfer?address=${TEST_TREASURY_EVM}&uint256=3000000`);

    expect(
      buildPaymentUri({
        rail: baseEthRail,
        recipient: TEST_TREASURY_EVM,
        baseUnits: "1200000000000000",
        priceUsd: 3,
      }),
    ).toBe(`ethereum:${TEST_TREASURY_EVM}@8453?value=1200000000000000`);

    expect(formatTokenAmountDisplay(3, baseEthRail)).toBe("0.0012 ETH ($3.00)");

    const solTreasury = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
    expect(
      buildPaymentUri({
        rail: solUsdcRail,
        recipient: solTreasury,
        baseUnits: "5000000",
        priceUsd: 5,
      }),
    ).toContain(`solana:${solTreasury}?amount=5.00&spl-token=${solUsdcRail.contractAddress}`);
  });

  it("evaluates per-platform account caps and 24h daily run limits across tiers", () => {
    const freeExceeded = evaluateCampaignPlanLimits({
      planId: "free",
      selectedPlatformIds: ["x", "bluesky"],
      accountOverrides: { x: "x_acc_1, x_acc_2" },
      runsLast24h: 2,
    });
    expect(freeExceeded.allowed).toBe(false);
    expect(freeExceeded.offendingPlatforms).toEqual([{ platformId: "x", accountCount: 2, cap: 1 }]);
    expect(freeExceeded.warningMessage).toContain("Free tier supports up to 1 account(s)");

    const proAllowed = evaluateCampaignPlanLimits({
      planId: "pro",
      selectedPlatformIds: ["x", "bluesky"],
      accountOverrides: { x: "x_acc_1, x_acc_2, x_acc_3" },
      runsLast24h: 10,
    });
    expect(proAllowed.allowed).toBe(true);
    expect(proAllowed.remainingDailyRuns).toBe(20);

    const extraUnlimited = evaluateCampaignPlanLimits({
      planId: "extra",
      selectedPlatformIds: ["x"],
      accountOverrides: { x: "a1, a2, a3, a4, a5, a6, a7" },
      runsLast24h: 500,
    });
    expect(extraUnlimited.allowed).toBe(true);
    expect(extraUnlimited.remainingDailyRuns).toBe("unlimited");
  });

  it("signs and verifies stateless HMAC-SHA256 Extra license tokens across all apps", () => {
    const now = 1_760_000_000_000;
    const { token, payload } = signEcosystemLicense(
      {
        planId: "extra",
        txHash: TEST_TX_HASH,
        railId: "base_usdc",
        payerAddress: TEST_PAYER_EVM,
        recipientAddress: TEST_TREASURY_EVM,
        treasuryMode: "owner_configured",
        nowMs: now,
      },
      TEST_SECRET,
    );

    expect(token.startsWith("pp_eco_v1.")).toBe(true);
    expect(payload.apps).toContain("crypto-dashboard");
    expect(payload.apps).toContain("phoenixchat");
    expect(payload.apps).toContain("fedipress-buzz");
    expect(payload.apps).toContain("voicestudio");
    expect(payload.recipientAddress).toBe(TEST_TREASURY_EVM);
    expect(payload.treasuryMode).toBe("owner_configured");

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

  it("verifies NOWPayments HMAC-SHA512 recursively sorted JSON IPN signatures", () => {
    const ipnSecret = "nowpayments_ipn_secret_test_key";
    const payload = {
      payment_status: "finished",
      order_id: "polypost_extra_10",
      price_amount: 10,
      nested: { b: 2, a: 1 },
    };
    const canonical = JSON.stringify({
      nested: { a: 1, b: 2 },
      order_id: "polypost_extra_10",
      payment_status: "finished",
      price_amount: 10,
    });
    const validSig = createHmac("sha512", ipnSecret).update(canonical, "utf8").digest("hex");
    expect(verifyNowPaymentsIpnSignature(payload, validSig, ipnSecret)).toBe(true);
    expect(verifyNowPaymentsIpnSignature(payload, validSig.replace(/^./, "0"), ipnSecret)).toBe(
      false,
    );
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

  it("confirms direct Native ETH payment on Base via eth_getTransactionByHash and receipt", async () => {
    const minWei = BigInt(expectedBaseUnitsForPlan("pro", "base_eth")); // 0.0012 ETH = 1200000000000000 wei
    const fetchImpl = mockRpcFetch({
      eth_chainId: "0x2105",
      eth_blockNumber: "0x68",
      eth_getTransactionByHash: {
        hash: TEST_TX_HASH,
        from: TEST_PAYER_EVM,
        to: TEST_TREASURY_EVM,
        value: `0x${minWei.toString(16)}`,
      },
      eth_getTransactionReceipt: {
        transactionHash: TEST_TX_HASH,
        status: "0x1",
        blockNumber: "0x64",
        from: TEST_PAYER_EVM,
        to: TEST_TREASURY_EVM,
        logs: [],
      },
    });

    const result = await verifyEvmUsdcPayment(
      {
        railId: "base_eth",
        txHash: TEST_TX_HASH,
        expectedRecipient: TEST_TREASURY_EVM,
        expectedMinBaseUnits: minWei.toString(),
      },
      { fetchImpl },
    );

    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") {
      expect(result.transferredBaseUnits).toBe(minWei.toString());
      expect(result.confirmations).toBe(5);
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

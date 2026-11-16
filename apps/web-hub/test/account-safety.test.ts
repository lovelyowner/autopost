import { describe, expect, it } from "vitest";
import {
  PLATFORM_SAFETY_CAPS,
  detectMultiAccountProxyCollisions,
  extractProxyEndpointKey,
  normalizePlatformFamily,
} from "../lib/account-safety";
import { matchesSearchAndLetter } from "../components/LetterFilterBar";

describe("account safety and proxy collision guard", () => {
  it("flags 2+ accounts on the same platform sharing Direct IP or the same proxy endpoint", () => {
    const warnings = detectMultiAccountProxyCollisions([
      { account_id: "x_acc_1", platform: "x", proxy: null },
      { account_id: "x_acc_2", platform: "x", proxy: "" },
      { account_id: "ig_1", platform: "instagram", proxy: "http://user1:pass@1.2.3.4:8080" },
      { account_id: "ig_2", platform: "instagram", proxy: "http://user2:pass@1.2.3.4:8080" },
      { account_id: "bsky_1", platform: "bluesky", proxy: null },
    ]);

    expect(warnings.length).toBe(2);
    const xWarn = warnings.find((w) => w.platform === "x");
    const igWarn = warnings.find((w) => w.platform === "instagram");
    expect(xWarn?.isDirectIp).toBe(true);
    expect(xWarn?.accounts).toEqual(["x_acc_1", "x_acc_2"]);
    expect(igWarn?.isDirectIp).toBe(false);
    expect(igWarn?.endpointLabel).toBe("1.2.3.4:8080");
  });

  it("does not flag distinct proxies or single accounts per platform", () => {
    const warnings = detectMultiAccountProxyCollisions([
      { account_id: "only_1", platform: "onlyfans_feed", proxy: null },
      { account_id: "only_2", platform: "onlyfans_ppv", proxy: "http://***:***@10.0.0.1:8000" },
      { account_id: "only_3", platform: "onlyfans", proxy: "http://***:***@10.0.0.2:8000" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("normalizes platform families and proxy endpoint keys", () => {
    expect(normalizePlatformFamily("pornhub_video")).toBe("pornhub");
    expect(normalizePlatformFamily("revolt")).toBe("stoat");
    expect(extractProxyEndpointKey("socks5://***:***@proxy.example.net:1080")).toBe("proxy.example.net:1080");
    expect(extractProxyEndpointKey(null)).toBe("DIRECT_IP");
    expect(PLATFORM_SAFETY_CAPS.some((c) => c.id === "fluxer")).toBe(true);
    expect(PLATFORM_SAFETY_CAPS.some((c) => c.id === "discord")).toBe(true);
  });

  it("filters platform names by search text and A-Z letter", () => {
    expect(matchesSearchAndLetter("Fluxer Web Session", "fluxer", "", "F")).toBe(true);
    expect(matchesSearchAndLetter("Fluxer Web Session", "fluxer", "", "D")).toBe(false);
    expect(matchesSearchAndLetter("Stoat (Revolt) Web Session", "stoat", "revolt", "S")).toBe(true);
    expect(matchesSearchAndLetter("Pinterest Creator", "pinterest", "pin", "all")).toBe(true);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

// Pure BigInt secp256k1 BIP-340 Schnorr implementation (zero external native dependencies)
const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a: bigint, m = SECP_P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, m = SECP_P): bigint {
  let res = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = mod(res * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return res;
}

function modInv(a: bigint, m = SECP_P): bigint {
  return modPow(a, m - 2n, m);
}

interface Point {
  x: bigint;
  y: bigint;
}

function pointAdd(p1: Point | null, p2: Point | null): Point | null {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x && p1.y !== p2.y) return null;
  const lam =
    p1.x === p2.x
      ? mod(3n * p1.x * p1.x * modInv(2n * p1.y))
      : mod((p2.y - p1.y) * modInv(p2.x - p1.x));
  const x3 = mod(lam * lam - p1.x - p2.x);
  const y3 = mod(lam * (p1.x - x3) - p1.y);
  return { x: x3, y: y3 };
}

function pointMul(k: bigint, pt: Point = { x: SECP_GX, y: SECP_GY }): Point {
  let res: Point | null = null;
  let addend: Point | null = pt;
  let n = mod(k, SECP_N);
  while (n > 0n) {
    if (n & 1n) res = pointAdd(res, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  if (!res) throw new Error("Invalid scalar for secp256k1 multiplication");
  return res;
}

function numTo32BytesHex(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

function taggedHash(tag: string, msg: Buffer): Buffer {
  const tagHash = createHash("sha256").update(tag, "utf8").digest();
  return createHash("sha256").update(Buffer.concat([tagHash, tagHash, msg])).digest();
}

export function deriveNostrPubkeyHex(privKeyHex: string): string {
  const clean = privKeyHex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("NOSTR_PRIVATE_KEY must be a 64-character hex secret key");
  }
  const d0 = BigInt(`0x${clean}`);
  if (d0 <= 0n || d0 >= SECP_N) {
    throw new Error("NOSTR_PRIVATE_KEY scalar out of range");
  }
  const P = pointMul(d0);
  return numTo32BytesHex(P.x);
}

/** Generate a fresh secp256k1 keypair for 1-click Nostr onboarding. */
export function generateNostrKeypair(): { privateKeyHex: string; publicKeyHex: string } {
  while (true) {
    const candidate = randomBytes(32);
    const hex = candidate.toString("hex");
    const d0 = BigInt(`0x${hex}`);
    if (d0 > 0n && d0 < SECP_N) {
      return {
        privateKeyHex: hex,
        publicKeyHex: deriveNostrPubkeyHex(hex),
      };
    }
  }
}

export function signBip340SchnorrHex(msgHash32Hex: string, privKeyHex: string): string {
  const d0 = BigInt(`0x${privKeyHex.trim().replace(/^0x/i, "")}`);
  const P = pointMul(d0);
  const d = P.y % 2n === 0n ? d0 : SECP_N - d0;
  const pxBytes = Buffer.from(numTo32BytesHex(P.x), "hex");
  const mBytes = Buffer.from(msgHash32Hex, "hex");
  const aux = randomBytes(32);
  const tHash = taggedHash("BIP0340/aux", aux);
  const dBytes = Buffer.from(numTo32BytesHex(d), "hex");
  const t = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) t[i] = dBytes[i] ^ tHash[i];
  const rand = taggedHash("BIP0340/nonce", Buffer.concat([t, pxBytes, mBytes]));
  const k0 = mod(BigInt(`0x${rand.toString("hex")}`), SECP_N);
  if (k0 === 0n) throw new Error("Schnorr nonce zero");
  const R = pointMul(k0);
  const k = R.y % 2n === 0n ? k0 : SECP_N - k0;
  const rxBytes = Buffer.from(numTo32BytesHex(R.x), "hex");
  const eHash = taggedHash("BIP0340/challenge", Buffer.concat([rxBytes, pxBytes, mBytes]));
  const e = mod(BigInt(`0x${eHash.toString("hex")}`), SECP_N);
  const s = mod(k + e * d, SECP_N);
  return `${numTo32BytesHex(R.x)}${numTo32BytesHex(s)}`;
}

export interface SignedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function createSignedNostrEvent(opts: {
  privKeyHex: string;
  content: string;
  tags?: string[][];
  kind?: number;
  createdAt?: number;
}): SignedNostrEvent {
  const pubkey = deriveNostrPubkeyHex(opts.privKeyHex);
  const created_at = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const kind = opts.kind ?? 1;
  const tags = opts.tags ?? [];
  const content = opts.content;
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = createHash("sha256").update(serialized, "utf8").digest("hex");
  const sig = signBip340SchnorrHex(id, opts.privKeyHex);
  return { id, pubkey, created_at, kind, tags, content, sig };
}

async function broadcastEventToRelay(relayUrl: string, event: SignedNostrEvent): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const WS = (globalThis as any).WebSocket;
      if (!WS) {
        resolve(false);
        return;
      }
      const ws = new WS(relayUrl);
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(false);
      }, 4500);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(["EVENT", event]));
        } catch {
          clearTimeout(timeout);
          resolve(false);
        }
      };
      ws.onmessage = (msg: any) => {
        try {
          const parsed = JSON.parse(String(msg.data || ""));
          if (Array.isArray(parsed) && parsed[0] === "OK" && parsed[1] === event.id) {
            clearTimeout(timeout);
            try {
              ws.close();
            } catch {}
            resolve(Boolean(parsed[2]));
          }
        } catch {}
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {}
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

export class NostrConnector implements PlatformConnector {
  constructor(public id = "nostr") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const privKey = (payload.credentials?.privateKey ?? process.env.NOSTR_PRIVATE_KEY ?? "").trim();
    const rawRelays =
      payload.credentials?.relays ??
      process.env.NOSTR_RELAYS ??
      "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net";
    const relays = rawRelays
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^wss?:\/\//i.test(s));

    if (!privKey) {
      assertSimulationAllowed(
        payload.strictLive,
        "Nostr live publish requires NOSTR_PRIVATE_KEY (64-char hex secret key) in API / Bot Keys.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://njump.me/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const noteContent =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;
    const tags: string[][] = (payload.tags || []).map((t) => ["t", t.replace(/^#/, "")]);
    if (payload.linkUrl && !payload.firstComment) {
      tags.push(["r", payload.linkUrl]);
    }

    const event = createSignedNostrEvent({
      privKeyHex: privKey,
      content: noteContent,
      tags,
      kind: 1,
    });

    const results = await Promise.all(relays.map((r) => broadcastEventToRelay(r, event)));
    if (!results.some(Boolean) && payload.strictLive) {
      throw new Error(`Nostr relays (${relays.join(", ")}) did not acknowledge event ${event.id}`);
    }

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment) {
      const replyEvent = createSignedNostrEvent({
        privKeyHex: privKey,
        content: payload.firstComment,
        tags: [
          ["e", event.id, relays[0] || "", "root"],
          ["p", event.pubkey],
        ],
        kind: 1,
      });
      await Promise.all(relays.map((r) => broadcastEventToRelay(r, replyEvent)));
      firstCommentId = replyEvent.id;
      firstCommentUrl = `https://njump.me/${replyEvent.id}`;
    }

    return {
      success: true,
      platformId: this.id,
      publishedUrl: `https://njump.me/${event.id}`,
      postId: event.id,
      firstCommentId,
      firstCommentUrl,
    };
  }
}

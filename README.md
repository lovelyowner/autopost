# PolyPost — Omni-Channel Funnel & Creator Autopost Engine

Multi-platform creator distribution studio supporting **130+ platforms** across native APIs (Nostr NIP-01 Schnorr, Bluesky ATProto, Mastodon, Misskey, Lemmy/PieFed, Tumblr NPF, Telegram, Matrix v3, Farcaster/Neynar, Reddit, WordPress, Dev.to, Stoat/Revolt, VK, Discord/Slack Webhooks, PeerTube, e621, DeviantArt, Inkbunny) and encrypted Patchright Stealth Browser vaults (`OnlyFans`, `Fansly`, `ManyVids`, `LoyalFans`, `Clips4Sale`, `MYM`, `JFF`, `Maloum`, `Boosty`, `FanCentro`, `Slushy`, `APClips`, `Pornhub`, `XVideos`, `RedGIFs`, `Rumble`, `BitChute`, `Odysee`).

## Quick Start (Local / Full VPS)

```bash
cp .env.example .env
npm install
npm run dev
```

Or launch all services with Docker Compose (`Redis`, `Ollama`, `stealth-browser-worker`, `node-api-worker`, `web-hub`):

```bash
docker compose up -d --build
```

Open `http://localhost:3000`.

## Deploying Web Hub to Vercel

1. Set **Root Directory** to `./` (uses [`vercel.json`](./vercel.json)) or `apps/web-hub`.
2. Add Environment Variables:
   - `REDIS_URL` (e.g. Upstash Redis or external Redis TCP URL)
   - `STEALTH_WORKER_URL` (URL of your deployed Python Patchright worker on Railway/VPS)
3. Note: Stateful Chromium browser sessions (`apps/stealth-browser-worker`), 4K FFmpeg video transcoding, and 24/7 BullMQ delayed queues require a persistent Docker/VPS runtime alongside or instead of serverless Vercel functions.

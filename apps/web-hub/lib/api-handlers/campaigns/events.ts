import { NextRequest } from "next/server";
import { getCampaignState } from "@polypost/node-api-worker";
import { getSharedRedis } from "@/lib/redis-singleton";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const redis = getSharedRedis();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSerialized = "";
      let closed = false;

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", finish);

      const startedAt = Date.now();
      while (!closed && Date.now() - startedAt < 120_000) {
        try {
          const snapshot = await getCampaignState(redis, id);
          if (snapshot) {
            const payload = JSON.stringify(snapshot);
            if (payload !== lastSerialized) {
              lastSerialized = payload;
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
            if (snapshot.step === "completed" || snapshot.step === "failed") {
              finish();
              break;
            }
          }
        } catch {
          // Continue polling briefly until timeout/abort
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

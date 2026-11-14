import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_PLATFORMS, calculateUploadConstraints, type ScalingMode } from "@polypost/platform-registry";

import { getStealthWorkerUrl, STEALTH_WORKER_OFFLINE_REASON } from "@/lib/stealth-client";

export async function POST(req: NextRequest) {
  const stealthUrl = getStealthWorkerUrl();

  try {
    const body = await req.json();
    const { method, params, id } = body;

    if (method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "list_platforms",
              description: "Lists all active supported platforms across all quadrants and transports.",
              inputSchema: { type: "object", properties: { quadrant: { type: "string" } } },
            },
            {
              name: "calculate_constraints",
              description: "Calculates reactive upload size ceilings, bottleneck platform, and next limits.",
              inputSchema: {
                type: "object",
                required: ["platformIds"],
                properties: {
                  platformIds: { type: "array", items: { type: "string" } },
                  mode: { type: "string", enum: ["strict", "waterfall_autoscale"] },
                },
              },
            },
            {
              name: "list_vault_profiles",
              description: "Lists saved browser session profiles from the Stealth Browser Worker vault.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "get_session_health",
              description: "Runs real pre-flight session health verification against a vaulted account profile.",
              inputSchema: {
                type: "object",
                required: ["accountId", "platform"],
                properties: {
                  accountId: { type: "string" },
                  platform: { type: "string" },
                },
              },
            },
          ],
        },
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === "list_platforms") {
        const quadrant = args.quadrant;
        const list = quadrant
          ? ACTIVE_PLATFORMS.filter((p) => p.quadrant === quadrant)
          : ACTIVE_PLATFORMS;
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(list) }] },
        });
      }

      if (toolName === "calculate_constraints") {
        const res = calculateUploadConstraints(
          args.platformIds || [],
          (args.mode as ScalingMode) || "strict",
        );
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res) }] },
        });
      }

      if (toolName === "list_vault_profiles") {
        if (!stealthUrl) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify({ error: STEALTH_WORKER_OFFLINE_REASON, profiles: [] }) }],
            },
          });
        }
        try {
          const res = await fetch(`${stealthUrl}/api/profiles`, { signal: AbortSignal.timeout(3000) });
          const data = await res.json();
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(data) }] },
          });
        } catch (err: any) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify({ error: `Stealth worker unreachable: ${err.message}`, profiles: [] }) }],
            },
          });
        }
      }

      if (toolName === "get_session_health") {
        if (!stealthUrl) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    account_id: args.accountId,
                    platform: args.platform,
                    healthy: false,
                    reason: STEALTH_WORKER_OFFLINE_REASON,
                  }),
                },
              ],
            },
          });
        }
        try {
          const res = await fetch(`${stealthUrl}/api/sessions/health`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: args.accountId,
              platform: args.platform,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          const data = await res.json();
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(data) }] },
          });
        } catch (err: any) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    account_id: args.accountId,
                    platform: args.platform,
                    healthy: false,
                    reason: `Stealth worker unreachable (${err.message})`,
                  }),
                },
              ],
            },
          });
        }
      }

      return NextResponse.json(
        { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${toolName}` } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: { status: "PolyPost MCP server active" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: err.message } },
      { status: 500 },
    );
  }
}

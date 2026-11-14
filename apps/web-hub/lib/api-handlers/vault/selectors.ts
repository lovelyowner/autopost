import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveMonorepoRoot } from "@polypost/node-api-worker";
import { getStealthWorkerUrl } from "@/lib/stealth-client";

interface SelectorRecipeOverride {
  upload_url?: string;
  url_prefix?: string;
  file_input_selectors?: string[];
  title_selectors?: string[];
  description_selectors?: string[];
  tag_selectors?: string[];
  compliance_selectors?: string[];
  submit_selectors?: string[];
}

function resolveOverridesFile(): string {
  if (process.env.POLYPOST_SELECTOR_OVERRIDES) {
    return resolve(process.env.POLYPOST_SELECTOR_OVERRIDES);
  }
  if (process.env.VERCEL) {
    const tmpFile = "/tmp/polypost/config/selector-overrides.json";
    if (existsSync(tmpFile)) return tmpFile;
    const bundledFile = join(resolveMonorepoRoot(), "config", "selector-overrides.json");
    return existsSync(bundledFile) ? bundledFile : tmpFile;
  }
  return join(resolveMonorepoRoot(), "config", "selector-overrides.json");
}

function resolveOverridesWriteFile(): string {
  if (process.env.POLYPOST_SELECTOR_OVERRIDES) {
    return resolve(process.env.POLYPOST_SELECTOR_OVERRIDES);
  }
  if (process.env.VERCEL) {
    return "/tmp/polypost/config/selector-overrides.json";
  }
  return join(resolveMonorepoRoot(), "config", "selector-overrides.json");
}

function readOverridesMap(): Record<string, SelectorRecipeOverride> {
  const filePath = resolveOverridesFile();
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverridesMap(map: Record<string, SelectorRecipeOverride>): void {
  const filePath = resolveOverridesWriteFile();
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(map, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

function cleanSelectorList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.map((s) => String(s).trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const platformId = req.nextUrl.searchParams.get("platform")?.trim() || "";
  const overrides = readOverridesMap();

  if (!platformId) {
    return NextResponse.json({ overrides, overridesPath: resolveOverridesFile() });
  }

  let workerRecipe: Record<string, any> | null = null;
  const stealthUrl = getStealthWorkerUrl();
  if (stealthUrl) {
    try {
      const res = await fetch(`${stealthUrl}/api/selectors/${encodeURIComponent(platformId)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        workerRecipe = data.recipe || null;
      }
    } catch {
      // Fallback to local overrides when worker is offline
    }
  }

  return NextResponse.json({
    platform_id: platformId,
    recipe: workerRecipe,
    override: overrides[platformId] || null,
    overridesPath: resolveOverridesFile(),
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const platformId = String(body.platform || "").trim();
    if (!platformId || !/^[a-zA-Z0-9_-]+$/.test(platformId)) {
      return NextResponse.json({ error: "Valid alphanumeric 'platform' identifier is required." }, { status: 400 });
    }

    const r = body.recipe && typeof body.recipe === "object" ? body.recipe : {};
    const sanitized: SelectorRecipeOverride = {};
    if (typeof r.upload_url === "string" && r.upload_url.trim()) {
      sanitized.upload_url = r.upload_url.trim();
    }
    if (typeof r.url_prefix === "string" && r.url_prefix.trim()) {
      sanitized.url_prefix = r.url_prefix.trim();
    }
    for (const key of [
      "file_input_selectors",
      "title_selectors",
      "description_selectors",
      "tag_selectors",
      "compliance_selectors",
      "submit_selectors",
    ] as const) {
      const cleaned = cleanSelectorList(r[key]);
      if (cleaned !== undefined && (cleaned.length > 0 || key === "compliance_selectors")) {
        sanitized[key] = cleaned;
      }
    }

    const current = readOverridesMap();
    current[platformId] = sanitized;
    writeOverridesMap(current);

    return NextResponse.json({
      success: true,
      platform_id: platformId,
      override: sanitized,
      overridesPath: resolveOverridesFile(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save selector override" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const platformId = req.nextUrl.searchParams.get("platform")?.trim() || "";
  if (!platformId) {
    return NextResponse.json({ error: "Query param 'platform' required" }, { status: 400 });
  }
  const current = readOverridesMap();
  delete current[platformId];
  writeOverridesMap(current);
  return NextResponse.json({ success: true, platform_id: platformId });
}

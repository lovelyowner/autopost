import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveDataDir } from "@polypost/node-api-worker";

const SAFE_PNG_NAME = /^[a-zA-Z0-9._-]+\.png$/;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> },
) {
  const { filename } = await context.params;
  if (!SAFE_PNG_NAME.test(filename)) {
    return NextResponse.json({ error: "Invalid failure screenshot filename" }, { status: 400 });
  }

  const failuresDir = resolve(join(resolveDataDir(), "failures"));
  const targetPath = resolve(join(failuresDir, filename));
  if (dirname(targetPath) !== failuresDir || !existsSync(targetPath)) {
    return NextResponse.json({ error: "Failure screenshot not found" }, { status: 404 });
  }

  const png = readFileSync(targetPath);
  return new NextResponse(png, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
    },
  });
}

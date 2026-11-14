export interface ConnectorResult {
  success: boolean;
  platformId: string;
  publishedUrl?: string;
  postId?: string;
  firstCommentId?: string;
  firstCommentUrl?: string;
  failureScreenshot?: string;
  simulated?: boolean;
  error?: string;
}

export interface PostPayload {
  platformId: string;
  accountId: string;
  text: string;
  filePath?: string;
  isStillImage?: boolean;
  linkUrl?: string;
  tags?: string[];
  firstComment?: string;
  strictLive?: boolean;
  credentials?: Record<string, string>;
  extraParams?: Record<string, any>;
}

export interface PlatformConnector {
  id: string;
  publish(payload: PostPayload): Promise<ConnectorResult>;
}

export function isSimulationDisabled(): boolean {
  const flag = (process.env.DISABLE_SIMULATED_CONNECTORS || "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function assertSimulationAllowed(
  strictLive: boolean | undefined,
  missingRequirement: string,
): void {
  if (strictLive || isSimulationDisabled()) {
    const suffix = isSimulationDisabled() ? " (DISABLE_SIMULATED_CONNECTORS=1)" : "";
    throw new Error(`${missingRequirement}${suffix}`);
  }
}

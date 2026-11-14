import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRootEnv } from "../../scripts/load-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
applyRootEnv(resolve(here, "../.."));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["onnxruntime-node", "bullmq", "ioredis"],
  transpilePackages: [
    "@polypost/platform-registry",
    "@polypost/media-reconciler",
    "@polypost/ai-caption-spinner",
    "@polypost/node-api-worker",
  ],
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    if (isServer) {
      config.externals = [...(config.externals || []), "onnxruntime-node", "@valkey/valkey-glide"];
    }
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns a bundled CLI subprocess — keep it external so the
  // bundler doesn't try to inline its .mjs / binary payload.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@codesandbox/sdk"],
};

export default nextConfig;

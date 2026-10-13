import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  /**
   * The Qoder Agent SDK loads a ~33 MB worker runtime from its own directory on
   * disk, so bundling it would both bloat the server bundle and break the
   * relative path the runtime is resolved from. Left external, it is required
   * from node_modules at call time.
   */
  serverExternalPackages: ["@qoder-ai/qoder-agent-sdk"],
  /**
   * Allow the dev server to be opened from other hosts on the LAN (phone
   * testing the candidate portal, etc.). Without this, `next dev` answers 403
   * for cross-origin dev asset/API requests.
   */
  allowedDevOrigins: [
    "192.168.1.6",
    "192.168.1.*",
    "10.0.0.*",
    "172.16.*",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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

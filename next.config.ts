import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [{ source: "/assistant/voice", destination: "/assistant", permanent: true }];
  },
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
  /**
   * The wordmark in every header is a `public/` file, and Next serves those with
   * `max-age=0` plus an ETag — so each page view pays a conditional request for
   * an image that only changes when the code is deployed. A day of freshness with
   * a week of background revalidation keeps the asset honest to its own deploy
   * while taking that round trip off the critical path.
   */
  async headers() {
    return [
      {
        source: "/:file(sdg-icon\\.png|favicon-32\\.png|apple-touch-icon\\.png)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

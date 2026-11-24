import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Let phones on the local network load dev scripts (otherwise pages render but never hydrate).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  // The card-scanner index is named by its content hash (its manifest is what changes), so it can be cached forever.
  async headers() {
    return [
      {
        source: "/data/:file(card-index\\.[0-9a-f]{16}\\.bin)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;

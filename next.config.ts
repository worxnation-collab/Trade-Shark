import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Scanner batches are big. Uploads go through a route handler, but keep server actions roomy too.
    serverActions: { bodySizeLimit: "200mb" },
  },
};

export default nextConfig;

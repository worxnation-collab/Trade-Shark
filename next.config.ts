import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Scanner batches are big. Uploads go through a route handler, but keep server actions roomy too.
    serverActions: { bodySizeLimit: "200mb" },
  },
  // PDF splitting runs on the server: mupdf (WASM) renders pages, opencv.js finds the cards. Load both from
  // node_modules at runtime instead of bundling them, and make sure their files ship with the PDF routes.
  serverExternalPackages: ["mupdf", "@techstark/opencv-js"],
  outputFileTracingIncludes: {
    "/api/admin/batches/[id]/pdf": ["./node_modules/mupdf/dist/**/*"],
    "/api/admin/batches/[id]/pdf/[pdfId]": ["./node_modules/mupdf/dist/**/*", "./node_modules/@techstark/opencv-js/dist/**/*", "./node_modules/@techstark/opencv-js/package.json"],
  },
};

export default nextConfig;

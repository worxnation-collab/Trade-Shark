// Copy opencv.js into public/ so the flatbed page can load it with a <script> tag
// (keeps the 10 MB WASM bundle out of the app's JS chunks; browsers cache it).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("@techstark/opencv-js");
const pkg = require("@techstark/opencv-js/package.json");
mkdirSync("public/vendor", { recursive: true });
const dest = path.join("public/vendor", `opencv-${pkg.version}.js`);
copyFileSync(src, dest);
console.log(`copied ${dest}`);

// pdf.js for PDF uploads: rendered in the browser (keeps PDF parsing out of the server bundle).
const pdfPkg = require("pdfjs-dist/package.json");
const pdfDir = path.join("public/vendor", `pdfjs-${pdfPkg.version}`);
mkdirSync(pdfDir, { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) copyFileSync(path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "build", f), path.join(pdfDir, f));
console.log(`copied ${pdfDir}`);

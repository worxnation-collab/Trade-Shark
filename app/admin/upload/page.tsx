import cvPkg from "@techstark/opencv-js/package.json";
import pdfPkg from "pdfjs-dist/package.json";
import Link from "next/link";
import { UploadForm } from "./UploadForm";

export const metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-extrabold">Upload a batch</h1>
        <Link href="/admin/flatbed" className="btn-ghost">Several cards on one copier scan? Use Flatbed split →</Link>
      </div>
      <UploadForm pdfjsVersion={pdfPkg.version} cvSrc={`/vendor/opencv-${cvPkg.version}.js`} />
    </div>
  );
}

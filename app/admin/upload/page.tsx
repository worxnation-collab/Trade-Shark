import { UploadForm } from "./UploadForm";

export const metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Upload a batch</h1>
      <UploadForm />
    </div>
  );
}

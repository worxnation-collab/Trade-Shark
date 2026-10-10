import Link from "next/link";
import { EmptyState } from "@/components/Brand";
import { db } from "@/lib/db";

export const metadata = { title: "Batches" };

export default async function Batches() {
  const batches = await db.batch.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { cards: true, files: true } } } });
  if (!batches.length)
    return (
      <EmptyState title="No batches yet">
        <Link href="/admin/upload" className="btn-primary">Upload your first batch</Link>
      </EmptyState>
    );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Batches</h1>
      <div className="card overflow-hidden">
        <table className="grid-table">
          <thead>
            <tr><th>Name</th><th>Files</th><th>Cards</th><th>Pairing</th><th>Created</th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/admin/batches/${b.id}`} className="font-semibold hover:text-teal">{b.name}</Link></td>
                <td>{b._count.files}</td>
                <td>{b._count.cards}</td>
                <td>{b.pairMode}</td>
                <td>{b.createdAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

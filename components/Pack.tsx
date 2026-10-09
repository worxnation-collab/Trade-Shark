import { PACK_NAME } from "@/lib/brandAssets";
import { categoryOf } from "@/lib/categories";

/**
 * The sealed pack, drawn from the fin (components/SharkFin.tsx): a flat navy body, one gold edge, the fin, and the
 * category name in Archivo Black. The same drawing for every category; no photo, mascot or foil. It is the only object
 * in the shop with a shadow. `className` lands on the wrapper (seal-top / seal-body / gone / ls-nudge use it).
 */
export function Pack({ category, className = "" }: { category: string; className?: string }) {
  const name = PACK_NAME[category] ?? categoryOf(category)?.name ?? "Trade Shark";
  return (
    <div className={`pack-shadow w-full ${className}`}>
      <svg viewBox="0 0 200 280" className="block h-auto w-full" role="img" aria-label={`${name} pack`}>
        {/* crimped seals, top and bottom */}
        <path d={crimp(0, 18)} fill="#081729" />
        <path d={crimp(262, 280, true)} fill="#081729" />
        <rect x="0" y="14" width="200" height="252" fill="#0B1F3A" />
        {/* the fin, light on navy */}
        <polygon points="62,146 106,81 123,95 126,146" fill="#F4EFE6" />
        {/* the one gold edge */}
        <rect x="0" y="262" width="200" height="2.5" fill="#D9A441" />
        <text x="100" y="190" textAnchor="middle" fill="#F4EFE6" fontSize="25" style={{ fontFamily: "var(--font-display)" }}>
          {name}
        </text>
      </svg>
    </div>
  );
}

/** A zigzag seal strip between y0 and y1; the teeth point outward (up for the top, down for the bottom). */
function crimp(y0: number, y1: number, down = false) {
  const teeth = 20;
  const w = 200 / teeth;
  const edge = down ? y1 : y0;
  const inner = down ? y0 : y1;
  let d = `M0 ${inner} L0 ${edge + (down ? -3 : 3)}`;
  for (let i = 0; i < teeth; i++) d += ` L${i * w + w / 2} ${edge} L${(i + 1) * w} ${edge + (down ? -3 : 3)}`;
  return `${d} L200 ${inner} Z`;
}

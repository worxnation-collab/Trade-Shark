import { PACK_NAME } from "@/lib/brandAssets";
import { categoryOf } from "@/lib/categories";

/**
 * The sealed pack in Pokéroll's look: an ink body, one yellow edge, the Pokéroll mark, and the category name. The same
 * drawing for every category; no photo or foil. It is the only object in the shop with a shadow. `className` lands
 * on the wrapper (seal-top / seal-body / gone / ls-nudge use it).
 */
export function Pack({ category, className = "" }: { category: string; className?: string }) {
  const name = PACK_NAME[category] ?? categoryOf(category)?.name ?? "Pokéroll";
  return (
    <div className={`pack-shadow w-full ${className}`}>
      <svg viewBox="0 0 200 280" className="block h-auto w-full" role="img" aria-label={`${name} pack`}>
        <defs>
          <clipPath id="pack-mark">
            <rect x="58" y="62" width="84" height="84" rx="22" />
          </clipPath>
        </defs>
        {/* crimped seals, top and bottom */}
        <path d={crimp(0, 18)} fill="#08090b" />
        <path d={crimp(262, 280, true)} fill="#08090b" />
        <rect x="0" y="14" width="200" height="252" fill="#111317" />
        {/* the Pokéroll mark */}
        <image href="/logo-mark.png" x="58" y="62" width="84" height="84" clipPath="url(#pack-mark)" />
        {/* the one yellow edge */}
        <rect x="0" y="259" width="200" height="4" fill="#F5C518" />
        <text x="100" y="196" textAnchor="middle" fill="#FFFFFF" fontSize="25" fontWeight="800" letterSpacing="-0.5" style={{ fontFamily: "var(--font-display)" }}>
          {name}
        </text>
        <text x="100" y="222" textAnchor="middle" fill="#F5C518" fontSize="11" fontWeight="700" letterSpacing="2" style={{ fontFamily: "var(--font-sans)" }}>
          POKÉROLL
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

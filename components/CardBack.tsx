/* eslint-disable @next/next/no-img-element */

/** A face-down card: the Pokéroll mark on ink with a yellow edge, the same back pokeroll.fun deals from. */
export function CardBack({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`grid aspect-[63/88] place-items-center rounded-[8%/5.7%] bg-[#111317] ring-2 ring-gold ring-inset ${className}`} style={style} aria-hidden>
      <img src="/logo-mark.png" alt="" draggable={false} className="w-[58%] rounded-[22%]" />
    </div>
  );
}

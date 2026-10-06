import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { categoryOf, isCategory } from "@/lib/categories";
import { currentBuyer } from "@/lib/game/buyer";
import { playState } from "@/lib/game/play";
import { oddsLines } from "@/lib/game/rules";
import { Game } from "./Game";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const c = categoryOf((await params).category);
  return { title: c ? `${c.product} · Trade Shark` : "Packs" };
}

/** The reveal game for one category. Rules and odds are on screen before the first $1. */
export default async function PackPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const cat = categoryOf(category)!;
  const state = await playState(await currentBuyer(), category);
  return (
    <section className="-mx-4 -my-8 bg-navy px-4 py-10 text-sand sm:mx-0 sm:my-0 sm:rounded-2xl sm:px-8">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal">{cat.name}</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{cat.product}</h1>
      </div>
      <Game
        category={category}
        product={cat.product}
        odds={oddsLines(state.chaseOn)}
        open={state.open}
        opensAt={state.opensAt ? new Date(state.opensAt).toISOString() : null}
        hasCard={state.hasCard}
        member={state.member}
        stackLeft={state.stackLeft}
        cardLabel={state.signedIn ? state.cardLabel : null}
        lockedUntil={state.lockedUntil ? new Date(state.lockedUntil).toISOString() : null}
        revealing={
          state.revealing && state.revealing.category === category
            ? { cycleId: state.revealing.cycleId, deadline: new Date(state.revealing.deadline).toISOString(), pack: state.revealing.pack }
            : null
        }
        serverNow={new Date().toISOString()}
      />
      <Disclaimer dark className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}

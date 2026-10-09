import { notFound } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { categoryOf, isCategory } from "@/lib/categories";
import { currentBuyer } from "@/lib/game/buyer";
import { playState } from "@/lib/game/play";
import { oddsLines } from "@/lib/game/rules";
import { PageTitle } from "@/components/Stage";
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
    <section>
      <PageTitle title={cat.product} />
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
      <Disclaimer className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}

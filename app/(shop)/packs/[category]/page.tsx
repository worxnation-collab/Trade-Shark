import { redirect } from "next/navigation";
import { Disclaimer } from "@/components/Disclaimer";
import { categoryOf, isPublicCategory } from "@/lib/categories";
import { headers } from "next/headers";
import { currentBuyer, ipKey } from "@/lib/game/buyer";
import { playState } from "@/lib/game/play";
import { oddsLines } from "@/lib/game/rules";
import { PageTitle } from "@/components/Stage";
import { Game } from "./Game";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const c = categoryOf((await params).category);
  return { title: c ? `${c.product} · Trade Shark` : "Packs" };
}

/** The pack screen for one public category. Rules and odds are on screen before the first look. Other categories go home. */
export default async function PackPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<{ error?: string }> }) {
  const { category } = await params;
  if (!isPublicCategory(category)) redirect("/");
  const { error } = await searchParams;
  const cat = categoryOf(category)!;
  const state = await playState(await currentBuyer(), category, ipKey(await headers()));
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
        looksLeft={state.looksLeft}
        nextLook={state.nextLook}
        revealing={
          state.revealing && state.revealing.category === category
            ? {
                cycleId: state.revealing.cycleId,
                deadline: new Date(state.revealing.deadline).toISOString(),
                pack: state.revealing.pack,
                lookNumber: state.revealing.lookNumber,
                keepPrice: state.revealing.keepPrice,
              }
            : null
        }
        serverNow={new Date().toISOString()}
        error={error ? error.slice(0, 200) : undefined}
      />
      <Disclaimer className="mx-auto mt-10 max-w-md text-center" />
    </section>
  );
}

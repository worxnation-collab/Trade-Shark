import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { layoutGuess, plan, topHeavy } from "@/lib/orient";
import { decide } from "@/lib/publish";

/** A fake upright card: noisy, colorful art in the top half, a flat cream text box below. */
async function fakeCard() {
  const W = 250, H = 350;
  const px = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const art = y > 30 && y < 175 && x > 15 && x < 235;
      if (art) [px[i], px[i + 1], px[i + 2]] = [rnd() * 255, rnd() * 255, rnd() * 120];
      else [px[i], px[i + 1], px[i + 2]] = [236, 226, 196];
    }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
}

describe("auto-orientation", () => {
  it("layout cue: busy part on top reads upright, upside down reads negative", async () => {
    const card = await fakeCard();
    expect(await topHeavy(card)).toBeGreaterThan(0.1);
    expect(await topHeavy(await sharp(card).rotate(180).toBuffer())).toBeLessThan(-0.1);
  });

  it("layout guess turns a sideways card upright either way, and leaves portrait alone", async () => {
    const card = await fakeCard();
    // The card was turned 90° clockwise on the flatbed → needs 270° clockwise back, and vice versa.
    const cw = await sharp(card).rotate(90).toBuffer();
    const ccw = await sharp(card).rotate(270).toBuffer();
    expect(await layoutGuess(cw, true)).toMatchObject({ deg: 270, how: "layout guess" });
    expect(await layoutGuess(ccw, true)).toMatchObject({ deg: 90 });
    // Without vision a portrait card is never flipped: the cue is too weak on real scans.
    expect((await layoutGuess(await sharp(card).rotate(180).toBuffer(), false)).deg).toBe(0);
    expect((await layoutGuess(card, false)).deg).toBe(0);
  });

  it("plan: a sure vision answer is not a guess; a sideways result or a weak guess on a sideways crop is held", () => {
    expect(plan({ deg: 90, how: "vision", sure: true }, true)).toEqual({ guess: false, sideways: false });
    expect(plan({ deg: 0, how: "vision", sure: true }, false)).toEqual({ guess: false, sideways: false });
    expect(plan({ deg: 180, how: "vision", sure: true }, false)).toEqual({ guess: false, sideways: false });
    // Vision says leave it, but the crop is landscape: still sideways.
    expect(plan({ deg: 0, how: "vision", sure: true }, true).sideways).toBe(true);
    // Layout guesses keep the original; a strong one publishes, a weak one on a sideways crop waits.
    expect(plan({ deg: 90, how: "layout guess", sure: true }, true)).toEqual({ guess: true, sideways: false });
    expect(plan({ deg: 270, how: "layout guess", sure: false }, true)).toEqual({ guess: true, sideways: true });
    expect(plan({ deg: 90, how: "vision", sure: false }, true)).toEqual({ guess: true, sideways: true });
  });

  it("maps the card's top edge to a clockwise turn", async () => {
    const { TURN_FOR_TOP } = await import("@/lib/orient");
    expect(TURN_FOR_TOP).toEqual({ top: 0, right: 270, bottom: 180, left: 90 });
  });

  it("a card still sideways never publishes: it goes to Needs a look", () => {
    const c = { name: "Pikachu", player: null, identSource: "vision:anthropic", readable: true, frontImage: "f.jpg", listPrice: 3 };
    expect(decide({ ...c, holdReason: "rotation" })).toBe("review");
    expect(decide({ ...c, holdReason: "rotation", listPrice: 0.4 })).toBe("review");
    expect(decide({ ...c, holdReason: null })).toBe("publish");
  });
});

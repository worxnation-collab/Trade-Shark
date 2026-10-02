import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { db } from "../db";
import { keys } from "../env";
import { forVision } from "../images";
import { CONDITIONS, GAMES, type CardFields, type Condition, type Game, type IdentCandidate, type IdentField } from "../types";
import { limiter, safeJson } from "../util";
import { fail, skip, type IdentifyAdapter, type IdentifyContext } from "./types";

/**
 * Vision identification. Sends the front (and back if present) to Claude or OpenAI and maps the
 * answer into the same fields every other source uses. Cached by image hash so re-running a batch
 * never pays twice. Concurrency capped by VISION_CONCURRENCY.
 */

const PROMPT = `You are identifying a single trading card from scanner or phone photos (front first, back second if present).
Return ONLY facts you can read or are confident about; use "" when unsure. Never guess a price.
Fields:
- game: one of Pokemon, Sports, Magic, Other
- name: card name (Pokemon/Magic) or player name (sports)
- set_name: set/product name as printed or as known (e.g. "Base", "Evolving Skies", "2023 Topps Chrome")
- set_code: short set code if printed (e.g. "SWSH07", "MH3"), else ""
- number: collector number exactly as printed, including "/total" if printed (e.g. "4/102", "TG12", "123")
- year: 4-digit year from copyright line or product, else ""
- variant: e.g. Holo, Reverse Holo, 1st Edition, Foil, Refractor, Rookie, Auto, Parallel name; "" if none
- rarity: if a rarity symbol/text is readable, else ""
- player, team: sports only, else ""
- condition_guess: NM, LP, MP, HP or DMG based on visible wear (corners, edges, scratches, creases)
- graded: slab grade like "PSA 10" if the card is in a grading slab, else ""
- confidence: 0..1 overall confidence that name+set+number are right
- field_confidence: 0..1 for name, set_name, number, year, variant
- notes: one short sentence on anything uncertain`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "game", "name", "set_name", "set_code", "number", "year", "variant", "rarity", "player", "team",
    "condition_guess", "graded", "confidence", "field_confidence", "notes",
  ],
  properties: {
    game: { type: "string", enum: [...GAMES] },
    name: { type: "string" },
    set_name: { type: "string" },
    set_code: { type: "string" },
    number: { type: "string" },
    year: { type: "string" },
    variant: { type: "string" },
    rarity: { type: "string" },
    player: { type: "string" },
    team: { type: "string" },
    condition_guess: { type: "string", enum: [...CONDITIONS] },
    graded: { type: "string" },
    confidence: { type: "number" },
    field_confidence: {
      type: "object",
      additionalProperties: false,
      required: ["name", "set_name", "number", "year", "variant"],
      properties: {
        name: { type: "number" },
        set_name: { type: "number" },
        number: { type: "number" },
        year: { type: "number" },
        variant: { type: "number" },
      },
    },
    notes: { type: "string" },
  },
} as const;

interface VisionOut {
  game: Game;
  name: string;
  set_name: string;
  set_code: string;
  number: string;
  year: string;
  variant: string;
  rarity: string;
  player: string;
  team: string;
  condition_guess: Condition;
  graded: string;
  confidence: number;
  field_confidence: { name: number; set_name: number; number: number; year: number; variant: number };
  notes: string;
}

let gate: ReturnType<typeof limiter> | null = null;
const visionGate = () => (gate ??= limiter(keys().visionConcurrency));

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function mapVision(v: VisionOut, provider: string): IdentCandidate {
  const s = (x: string | undefined) => (x && x.trim() ? x.trim() : undefined);
  const fields: CardFields = {
    game: (GAMES as readonly string[]).includes(v.game) ? v.game : "Other",
    name: s(v.name),
    setName: s(v.set_name),
    setCode: s(v.set_code),
    number: s(v.number),
    year: s(v.year),
    variant: s(v.variant),
    rarity: s(v.rarity),
    player: s(v.player),
    team: s(v.team),
    condition: (CONDITIONS as readonly string[]).includes(v.condition_guess) ? v.condition_guess : undefined,
    graded: s(v.graded),
  };
  // Vision models are confident liars; never let them self-report past 0.9.
  const cap = (n: number) => Math.min(0.9, clamp(n));
  const fc: Partial<Record<IdentField, number>> = {
    game: cap(v.confidence + 0.1),
    name: cap(v.field_confidence?.name),
    setName: cap(v.field_confidence?.set_name),
    setCode: cap(v.field_confidence?.set_name),
    number: cap(v.field_confidence?.number),
    year: cap(v.field_confidence?.year),
    variant: cap(v.field_confidence?.variant),
    rarity: cap(v.confidence * 0.8),
    player: cap(v.field_confidence?.name),
    team: cap(v.confidence * 0.8),
  };
  return { source: `vision:${provider}`, confidence: cap(v.confidence), fields, fieldConfidence: fc, note: v.notes || undefined };
}

async function images(ctx: IdentifyContext) {
  const out: { data: string; mime: "image/jpeg" }[] = [];
  for (const p of [ctx.frontImage, ctx.backImage]) {
    if (!p) continue;
    const img = await forVision(p);
    if (img) out.push(img);
  }
  return out;
}

async function cached(provider: string, model: string, ctx: IdentifyContext, call: () => Promise<VisionOut>) {
  const key = createHash("sha256")
    .update(`${provider}|${model}|${ctx.frontHash ?? ""}|${ctx.backHash ?? ""}`)
    .digest("hex");
  const hit = await db.visionCache.findUnique({ where: { hash: key } });
  if (hit) return { out: safeJson<VisionOut | null>(hit.result, null), cached: true };
  const out = await visionGate()(call);
  await db.visionCache.upsert({
    where: { hash: key },
    create: { hash: key, provider, result: JSON.stringify(out) },
    update: { result: JSON.stringify(out) },
  });
  return { out, cached: false };
}

function parseLooseJson(text: string): VisionOut {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("model returned no JSON");
  return JSON.parse(m[0]) as VisionOut;
}

export const anthropicVision: IdentifyAdapter = {
  id: "vision:anthropic",
  label: "Claude vision",
  games: "any",
  configured: () => (keys().anthropic ? { ok: true } : { ok: false, reason: "ANTHROPIC_API_KEY not set" }),
  async identify(ctx) {
    const { anthropic, anthropicModel } = keys();
    if (!anthropic) return skip("ANTHROPIC_API_KEY not set");
    const imgs = await images(ctx);
    if (!imgs.length) return skip("no readable image to send");
    try {
      const { out, cached: wasCached } = await cached("anthropic", anthropicModel, ctx, async () => {
        const client = new Anthropic({ apiKey: anthropic });
        const content: Anthropic.Beta.BetaContentBlockParam[] = [
          ...imgs.map(
            (i): Anthropic.Beta.BetaContentBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: i.mime, data: i.data },
            }),
          ),
          { type: "text", text: PROMPT },
        ];
        // Server-side refusal fallback is on by default; a refusal on a card photo is unlikely but handled.
        const params = {
          model: anthropicModel,
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content }],
        };
        const res = await client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
        if (res.stop_reason === "refusal") throw new Error("model declined this image");
        const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return parseLooseJson(text);
      });
      if (!out) return fail("cached vision result unreadable");
      const cand = mapVision(out, "anthropic");
      if (wasCached) cand.note = `${cand.note ?? ""} (cached)`.trim();
      return { status: "ok", data: [cand] };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const openaiVision: IdentifyAdapter = {
  id: "vision:openai",
  label: "OpenAI vision",
  games: "any",
  configured: () => (keys().openai ? { ok: true } : { ok: false, reason: "OPENAI_API_KEY not set" }),
  async identify(ctx) {
    const { openai, openaiModel } = keys();
    if (!openai) return skip("OPENAI_API_KEY not set");
    const imgs = await images(ctx);
    if (!imgs.length) return skip("no readable image to send");
    try {
      const { out, cached: wasCached } = await cached("openai", openaiModel, ctx, async () => {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${openai}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: openaiModel,
            response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: SCHEMA } },
            messages: [
              {
                role: "user",
                content: [
                  ...imgs.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })),
                  { type: "text", text: PROMPT },
                ],
              },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = (await res.json()) as { choices: { message: { content: string } }[] };
        return parseLooseJson(j.choices[0]?.message?.content ?? "");
      });
      if (!out) return fail("cached vision result unreadable");
      const cand = mapVision(out, "openai");
      if (wasCached) cand.note = `${cand.note ?? ""} (cached)`.trim();
      return { status: "ok", data: [cand] };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

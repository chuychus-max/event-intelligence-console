import Anthropic from "@anthropic-ai/sdk";
import { aiAnswer, ruleAnswer } from "@/lib/copilot";
import { json, snapshot } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { question?: string } | null;
  const q = body?.question?.trim().slice(0, 500);
  if (!q) return json({ error: "Escribe una pregunta" }, 400);
  const { state } = await snapshot();
  const rule = ruleAnswer(q, state);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ answer: rule ?? "Sin la llave de Claude sólo respondo preguntas sobre puertas, aforo, Protección Civil y acciones del copiloto.", by: "reglas" });
  }
  try {
    return json({ answer: await aiAnswer(q, state), by: "claude" });
  } catch (e) {
    const why = e instanceof Anthropic.RateLimitError ? "límite de uso" : e instanceof Anthropic.APIError ? `error ${e.status}` : "sin conexión";
    return json({ answer: rule ?? `Claude no respondió (${why}).`, by: "reglas", warning: `Claude no respondió (${why})` });
  }
}

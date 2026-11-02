import { json, snapshot } from "@/lib/server";

export const dynamic = "force-dynamic";

// Aprobar o descartar una acción pendiente del copiloto.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: string; decision?: string } | null;
  if (!body?.id || (body.decision !== "approve" && body.decision !== "dismiss")) {
    return json({ error: "Envía { id, decision: 'approve' | 'dismiss' }" }, 400);
  }
  const { store, state } = await snapshot();
  const action = state.actions.find((a) => a.id === body.id);
  if (!action) return json({ error: "La acción no existe en este evento" }, 404);
  if (action.status !== "pending") return json({ error: "La acción ya fue resuelta" }, 409);
  await store.setDecision(action.id, { decision: body.decision, minute: Math.max(0, Math.floor(state.minute)), at: Date.now() });
  return json({ ok: true });
}

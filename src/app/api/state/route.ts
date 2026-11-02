import { json, snapshot } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { state } = await snapshot();
    return json(state);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

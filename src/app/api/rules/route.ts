import { PACKS } from "@/domain/rules/engine";

export async function GET() {
  return Response.json(PACKS);
}

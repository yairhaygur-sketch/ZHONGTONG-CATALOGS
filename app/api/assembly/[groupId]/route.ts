import { listAssembly } from "../../../../db/catalog-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  try {
    const assembly = await listAssembly(decodeURIComponent(groupId ?? "").trim());
    if (!assembly) return Response.json({ error: "Assembly not found" }, { status: 404 });
    return Response.json(assembly);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

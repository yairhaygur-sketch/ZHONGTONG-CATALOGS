import { getPart } from "../../../../db/catalog-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partNumber: string }> },
) {
  const { partNumber } = await params;
  const requested = decodeURIComponent(partNumber ?? "").trim();
  if (!requested) return Response.json({ error: "Missing part number" }, { status: 400 });

  try {
    const part = await getPart(requested);
    if (!part) return Response.json({ error: "Part not found" }, { status: 404 });
    return Response.json(part);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

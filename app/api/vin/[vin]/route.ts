import { partsForVin } from "../../../../db/catalog-queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vin: string }> },
) {
  const { vin } = await params;
  const query = new URL(request.url).searchParams.get("q") ?? undefined;
  try {
    const result = await partsForVin(decodeURIComponent(vin ?? "").trim(), query);
    if (!result) return Response.json({ error: "VIN not found in any catalog" }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

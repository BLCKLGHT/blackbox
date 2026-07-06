import { NextRequest, NextResponse } from "next/server";
import { createSignedReadUrl, getIncidentRecord, verifyIncidentToken } from "@/lib/server/cloud-incidents";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: { incidentId: string } }) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    const record = await getIncidentRecord(params.incidentId);
    if (!record) return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    if (!verifyIncidentToken(record, token)) return NextResponse.json({ error: "Invalid incident token." }, { status: 403 });

    const uploads = await Promise.all(
      record.uploads.map(async (upload) => ({
        ...upload,
        readUrl: await createSignedReadUrl(upload.objectName)
      }))
    );

    return NextResponse.json({
      ...record,
      tokenHash: undefined,
      uploads
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load incident." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { appendIncidentUploads, createSignedUploadUrls, getIncidentRecord, verifyIncidentToken } from "@/lib/server/cloud-incidents";
import type { IncidentUploadObject } from "@/types/drive";

export const runtime = "nodejs";

type SignBody = {
  token: string;
  files: Array<{
    id: string;
    filename: string;
    contentType: string;
    kind: IncidentUploadObject["kind"];
    timestamp: number;
  }>;
};

type CompleteBody = {
  token: string;
  uploads: IncidentUploadObject[];
};

export async function POST(request: NextRequest, { params }: { params: { incidentId: string } }) {
  try {
    const body = (await request.json()) as SignBody;
    const record = await getIncidentRecord(params.incidentId);
    if (!record) return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    if (!verifyIncidentToken(record, body.token)) return NextResponse.json({ error: "Invalid incident token." }, { status: 403 });
    if (!Array.isArray(body.files) || !body.files.length) return NextResponse.json({ uploads: [] });

    const uploads = await createSignedUploadUrls(params.incidentId, body.files);
    return NextResponse.json({ uploads });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create upload URLs." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { incidentId: string } }) {
  try {
    const body = (await request.json()) as CompleteBody;
    const record = await getIncidentRecord(params.incidentId);
    if (!record) return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    if (!verifyIncidentToken(record, body.token)) return NextResponse.json({ error: "Invalid incident token." }, { status: 403 });

    const updated = await appendIncidentUploads(params.incidentId, body.uploads ?? []);
    return NextResponse.json({ lastUploadAt: updated?.lastUploadAt ?? null, uploadCount: updated?.uploads.length ?? 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update upload metadata." }, { status: 500 });
  }
}

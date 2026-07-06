import { NextRequest, NextResponse } from "next/server";
import { createIncidentRecord, sendIncidentSms } from "@/lib/server/cloud-incidents";
import type { GpsSample, HighImpactEvent } from "@/types/drive";

export const runtime = "nodejs";

type CreateIncidentBody = {
  sessionId: string;
  driverName: string;
  emergencyContactPhone: string;
  event: HighImpactEvent;
  lastKnownLocation: Pick<GpsSample, "latitude" | "longitude" | "accuracy" | "timestamp"> | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateIncidentBody;
    if (!body.sessionId || !body.event?.id || !body.event.timestamp) {
      return NextResponse.json({ error: "Missing incident session or event payload." }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const { record, token } = await createIncidentRecord({
      sessionId: body.sessionId,
      driverName: body.driverName,
      emergencyContactPhone: body.emergencyContactPhone,
      event: body.event,
      lastKnownLocation: body.lastKnownLocation,
      origin
    });
    const updated = await sendIncidentSms(record);
    return NextResponse.json({
      incidentId: updated.id,
      token,
      reviewUrl: updated.reviewUrl,
      protectedWindow: updated.protectedWindow,
      sms: updated.sms
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create incident." }, { status: 500 });
  }
}

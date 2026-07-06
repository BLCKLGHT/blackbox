import { AppShell } from "@/components/AppShell";
import { IncidentReviewClient } from "@/components/IncidentReviewClient";

export default function IncidentPage({ params, searchParams }: { params: { incidentId: string }; searchParams: { token?: string } }) {
  return (
    <AppShell>
      <IncidentReviewClient incidentId={params.incidentId} token={searchParams.token ?? ""} />
    </AppShell>
  );
}

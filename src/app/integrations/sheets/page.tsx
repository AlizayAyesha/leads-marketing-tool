import { prisma } from "@/lib/db/prisma";
import { integrationStatus } from "@/lib/env";
import { GoogleSheetsPanel } from "@/components/settings/google-panel";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function SheetsIntegrationPage() {
  const env = integrationStatus();
  const [connection, source, lastSheetSync] = await Promise.all([
    prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.leadSource.findFirst({ where: { type: "GOOGLE_SHEETS" } }).catch(() => null),
    import("@/lib/google/sync").then((mod) => mod.getLatestSheetSync()).catch(() => null),
  ]);
  const leadCount = await prisma.lead.count().catch(() => 0);

  return (
    <div>
      <PageHeader
        eyebrow="Google Sheets"
        title="Platform workbook"
        description="Leads already live in the app. Connect Google and push a copy into this spreadsheet."
      />
      <GoogleSheetsPanel
        configured={env.google.configured}
        email={connection?.googleEmail ?? null}
        sourceName={source?.name ?? null}
        spreadsheetId={
          source?.config && typeof source.config === "object"
            ? String((source.config as { spreadsheetId?: string }).spreadsheetId ?? "")
            : null
        }
        leadCount={leadCount}
        lastSheetUrl={lastSheetSync?.url ?? null}
      />
    </div>
  );
}

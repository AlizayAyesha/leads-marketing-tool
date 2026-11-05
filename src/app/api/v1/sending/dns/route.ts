import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";

import { withUser } from "@/lib/auth/http";
import { evaluateDomainAuthentication } from "@/lib/outreach/sender-config";

async function txt(name: string) {
  try {
    const rows = await dns.resolveTxt(name);
    return rows.map((row) => row.join(""));
  } catch {
    return [];
  }
}

export const POST = withUser(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { fromEmail?: string; mailboxEmail?: string };
  const fromEmail = (body.fromEmail || process.env.OUTREACH_FROM_EMAIL || "").trim();
  const domain = fromEmail.split("@")[1]?.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json({
      report: evaluateDomainAuthentication({ fromEmail, mailboxEmail: body.mailboxEmail, lookedUp: false }),
    });
  }
  const [spf, dmarc, dkim] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    txt(`google._domainkey.${domain}`),
  ]);
  return NextResponse.json({
    report: evaluateDomainAuthentication({
      fromEmail,
      mailboxEmail: body.mailboxEmail,
      spfRecords: spf,
      dmarcRecords: dmarc,
      dkimRecords: dkim,
      lookedUp: true,
    }),
  });
});

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Report = {
  summary: string;
  spf: string;
  dkim: string;
  dmarc: string;
  notes: string[];
};

export function DomainCheck({ fromEmail }: { fromEmail: string }) {
  const [mailbox, setMailbox] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    const response = await fetch("/api/v1/sending/dns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromEmail, mailboxEmail: mailbox }),
    });
    const body = (await response.json().catch(() => null)) as { report?: Report; error?: { message?: string } } | null;
    if (!response.ok || !body?.report) {
      setError(body?.error?.message || "DNS check failed.");
      return;
    }
    setReport(body.report);
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <Label htmlFor="mailbox">Connected Gmail address, if different from the From address</Label>
        <Input id="mailbox" value={mailbox} onChange={(event) => setMailbox(event.target.value)} placeholder="name@gmail.com" />
      </div>
      <Button type="button" variant="outline" onClick={() => void run()}>
        Look up SPF, DKIM, and DMARC
      </Button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {report ? (
        <div className="text-sm">
          <p>Result: {report.summary}. SPF {report.spf}. DKIM {report.dkim}. DMARC {report.dmarc}.</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">No lookup yet. Jarvis will not mark DNS as configured until records are observed, and it never edits DNS.</p>
      )}
    </div>
  );
}

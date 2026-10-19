"use client";

import { useState, useTransition } from "react";

import { disconnectGoogleAction, provisionWorkbookAction, pushLeadsToSheetAction, saveWorkbookSource } from "@/lib/actions/settings";
import { runFiveLeadSheetTest } from "@/lib/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PLATFORM_SHEETS, DEFAULT_WORKBOOK_ID, spreadsheetEditUrl } from "@/lib/google/workbook";

export function GoogleSheetsPanel({
  configured,
  email,
  sourceName,
  spreadsheetId,
  leadCount = 0,
  lastSheetUrl = null,
}: {
  configured: boolean;
  email: string | null;
  sourceName: string | null;
  spreadsheetId?: string | null;
  leadCount?: number;
  lastSheetUrl?: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(lastSheetUrl);
  const currentId = spreadsheetId || DEFAULT_WORKBOOK_ID;
  const connected = Boolean(email);
  const openUrl = sheetUrl || spreadsheetEditUrl(currentId);

  return (
    <section className="mb-8 glass rounded-2xl p-5">
      <h2 className="mb-2 font-[family-name:var(--font-syne)] text-lg">Google workbook</h2>
      <p className="mb-4 text-sm text-muted">
        {leadCount} lead{leadCount === 1 ? "" : "s"} are stored in Leads Marketing Tool. Google Sheets gets a copy after you
        connect the Google account that can edit this spreadsheet.{" "}
        <a className="text-emerald-300 underline" href={openUrl} target="_blank" rel="noreferrer">
          Open the workbook
        </a>
      </p>
      <p className="mb-4 text-sm">
        {connected ? (
          <span className="text-emerald-200">Google connected as {email}.</span>
        ) : configured ? (
          <span>Google OAuth is ready. Connect your account, then push leads.</span>
        ) : (
          <span className="text-muted">Google OAuth client is not in env yet.</span>
        )}
      </p>

      <div className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="pb-2">Tab</th>
              <th className="pb-2">Platform</th>
              <th className="pb-2">Use</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_SHEETS.map((sheet) => (
              <tr key={sheet.key} className="border-t border-white/5">
                <td className="py-2">{sheet.title}</td>
                <td className="py-2">{sheet.key}</td>
                <td className="py-2 text-muted">{sheet.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="grid gap-3 md:grid-cols-2"
        action={(formData) => {
          start(async () => {
            await saveWorkbookSource(formData);
            setMessage("Workbook saved. Connect Google, create tabs, then push leads.");
          });
        }}
      >
        <div>
          <Label htmlFor="name">Source name</Label>
          <Input id="name" name="name" defaultValue={sourceName || "Leads Marketing Tool workbook"} />
        </div>
        <div>
          <Label htmlFor="spreadsheetId">Spreadsheet ID or URL</Label>
          <Input id="spreadsheetId" name="spreadsheetId" defaultValue={currentId} required />
        </div>
        <Button type="submit" disabled={pending}>
          Save workbook
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted">
        If you cannot edit the default workbook, paste a Google Sheet you own, save it, then connect that Google
        account.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {configured ? (
          <>
            <Button asChild>
              <a href="/api/google/oauth">{connected ? "Reconnect Google" : "Connect Google account"}</a>
            </Button>
            {connected ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    await disconnectGoogleAction();
                    setMessage("Google disconnected.");
                  });
                }}
              >
                Disconnect Google
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">
            Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to create the tabs in Google. Until then,
            copy headers from `data/samples/` into each tab manually.
          </p>
        )}
        {configured ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || !connected}
            onClick={() => {
              start(async () => {
                const result = await provisionWorkbookAction();
                setMessage(
                  result.ok
                    ? `Tabs ready. Created: ${result.result.created.join(", ") || "none"}. Headers: ${result.result.headed.join(", ") || "none"}.`
                    : result.error,
                );
              });
            }}
          >
            Create platform tabs
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={pending || !connected || leadCount === 0}
          onClick={() => {
            start(async () => {
              const result = await pushLeadsToSheetAction();
              setOk(result.ok);
              if ("url" in result && result.url) setSheetUrl(result.url);
              setMessage(
                result.message ||
                  (result.ok ? `Pushed ${result.exported} lead(s) to the Leads tab.` : "Could not push leads."),
              );
            });
          }}
        >
          Push {leadCount} leads to Sheet
        </Button>
        <Button asChild variant="outline">
          <a href="/api/sheets/import">Import Leads tab</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/api/sheets/export">Export enrichment tab</a>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !connected}
          onClick={() => {
            start(async () => {
              const result = await runFiveLeadSheetTest();
              setMessage(
                `${result.valid} lead(s) tested; ${result.researched} researched; ${result.qualified} qualified; ${result.drafts} draft(s) awaiting review. External messages sent: ${result.sent}.`,
              );
            });
          }}
        >
          Run 5-lead test
        </Button>
      </div>
      {!connected && configured ? (
        <p className="mt-3 text-xs text-muted">
          Click Connect Google account. Allow Sheets access. Then Create platform tabs and Push leads.
        </p>
      ) : null}
      {message ? (
        <p className={`mt-3 text-sm ${ok === false ? "text-rose-300" : "text-emerald-200"}`}>
          {message}
          {ok !== false && openUrl ? (
            <>
              {" "}
              <a className="underline" href={openUrl} target="_blank" rel="noreferrer">
                Open Leads tab
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  importFiverrFromSheet,
  importFiverrGig,
  importFiverrInquiry,
  importUpworkFromSheet,
  importUpworkListing,
} from "@/lib/actions/freelance";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function FreelanceIntake() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);

  return (
    <div className="mb-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const result = await importUpworkFromSheet();
              setSheetMessage(
                result.ok
                  ? `Imported ${result.imported} row(s) from the Upwork tab.`
                  : result.error || "Upwork sheet import failed.",
              );
              router.refresh();
            });
          }}
        >
          Sync Upwork tab
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const result = await importFiverrFromSheet();
              setSheetMessage(
                result.ok
                  ? `Imported ${result.imported} row(s) from the Fiverr tab.`
                  : result.error || "Fiverr sheet import failed.",
              );
              router.refresh();
            });
          }}
        >
          Sync Fiverr tab
        </Button>
        {sheetMessage ? <p className="text-sm text-muted">{sheetMessage}</p> : null}
      </div>
    <div className="grid gap-4 xl:grid-cols-3">
      <form
        className="glass rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            await importUpworkListing(form);
            event.currentTarget.reset();
            router.refresh();
          });
        }}
      >
        <h3 className="mb-3 font-[family-name:var(--font-syne)]">Import Upwork listing</h3>
        <Field name="title" label="Title" required />
        <Field name="clientName" label="Client" />
        <Field name="budget" label="Budget" />
        <Field name="url" label="URL" />
        <Field name="skills" label="Skills (comma)" />
        <div className="mt-3">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" />
        </div>
        <Button className="mt-3" type="submit" disabled={pending}>
          Store + score
        </Button>
      </form>

      <form
        className="glass rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            await importFiverrGig(form);
            event.currentTarget.reset();
            router.refresh();
          });
        }}
      >
        <h3 className="mb-3 font-[family-name:var(--font-syne)]">Import Fiverr gig</h3>
        <Field name="title" label="Gig title" required />
        <Field name="keywords" label="Keywords (comma)" />
        <div className="mt-3">
          <Label htmlFor="gig-description">Description</Label>
          <Textarea id="gig-description" name="description" />
        </div>
        <Button className="mt-3" type="submit" variant="outline" disabled={pending}>
          Store gig
        </Button>
      </form>

      <form
        className="glass rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            await importFiverrInquiry(form);
            event.currentTarget.reset();
            router.refresh();
          });
        }}
      >
        <h3 className="mb-3 font-[family-name:var(--font-syne)]">Import buyer inquiry</h3>
        <Field name="buyerName" label="Buyer name" />
        <Field name="title" label="Subject" />
        <Field name="budget" label="Budget (optional)" />
        <div className="mt-3">
          <Label htmlFor="inquiry">Message</Label>
          <Textarea id="inquiry" name="message" required />
        </div>
        <Button className="mt-3" type="submit" variant="outline" disabled={pending}>
          Store inquiry
        </Button>
        </form>
    </div>
    </div>
  );
}

function Field({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <div className="mt-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required={required} />
    </div>
  );
}

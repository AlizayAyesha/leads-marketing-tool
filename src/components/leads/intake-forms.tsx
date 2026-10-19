"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { createManualLead, importCsv } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function LeadIntakeForms() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <form
        className="glass rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            await createManualLead(form);
            router.refresh();
            event.currentTarget.reset();
          });
        }}
      >
        <h3 className="mb-4 font-[family-name:var(--font-syne)]">Manual lead</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label="Name" />
          <Field name="company" label="Company" />
          <Field name="website" label="Website" />
          <Field name="email" label="Email" />
          <Field name="linkedinUrl" label="LinkedIn" />
          <Field name="industry" label="Industry" />
        </div>
        <div className="mt-3">
          <Label htmlFor="originalPost">Original post / request</Label>
          <Textarea id="originalPost" name="originalPost" placeholder="Only if the source actually contains this." />
        </div>
        <Button className="mt-4" type="submit" disabled={pending}>
          Store lead
        </Button>
      </form>

      <form
        className="glass rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            await importCsv(form);
            router.refresh();
          });
        }}
      >
        <h3 className="mb-2 font-[family-name:var(--font-syne)]">CSV import</h3>
        <p className="mb-4 text-sm text-muted">
          Local-first intake. Google Sheets import appears in Settings once OAuth is configured.
        </p>
        <Label htmlFor="file">CSV file</Label>
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        <Button className="mt-4" type="submit" variant="outline" disabled={pending}>
          Import CSV
        </Button>
      </form>
    </div>
  );
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} />
    </div>
  );
}

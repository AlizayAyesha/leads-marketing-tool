"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FormSubmitStatus } from "@/components/ui/task-run-status";

export function EngineSaveControls() {
  const { pending } = useFormStatus();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Running…" : "Save engine controls"}
        </Button>
      </div>
      <FormSubmitStatus doneLine="Engine controls saved." />
    </>
  );
}

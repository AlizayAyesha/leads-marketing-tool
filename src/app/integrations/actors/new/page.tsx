import { AddActorForm } from "@/components/integrations/add-actor-form";
import { PageHeader } from "@/components/ui/page";

export default function NewActorPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Add actor"
        title="Register by Actor ID"
        description="Jarvis will try to load the live input schema from Apify. If that fails, you can still save the actor and define fields manually."
      />
      <AddActorForm />
    </div>
  );
}

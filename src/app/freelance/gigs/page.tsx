import { prisma } from "@/lib/db/prisma";
import { GigActions } from "@/components/freelance/gig-actions";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function GigsPage() {
  const gigs = await prisma.gigProfile.findMany({ orderBy: { updatedAt: "desc" } });
  return (
    <div>
      <PageHeader
        eyebrow="Fiverr"
        title="Gig optimizer"
        description="Suggestions are for testing. Jarvis will not claim that a keyword will rank."
      />
      {gigs.length === 0 ? (
        <EmptyState title="No gigs imported" description="Add a gig from the Freelance Command Center." />
      ) : (
        <div className="space-y-4">
          {gigs.map((gig) => (
            <article key={gig.id} className="glass rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">{gig.title}</h2>
              <p className="mt-2 text-sm text-muted">{gig.description}</p>
              <GigActions gigId={gig.id} analysis={gig.analysis} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

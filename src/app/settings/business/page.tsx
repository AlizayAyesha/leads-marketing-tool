import { saveBusinessProfileAction } from "@/lib/actions/business-profile";
import { loadBusinessProfile } from "@/lib/business/store";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

const LISTS = [
  ["services", "Services you offer", "website redesign, online booking, local SEO"],
  ["targetIndustries", "Target industries (empty = any)", "dental clinic, restaurant, law firm"],
  ["targetLocations", "Target locations (empty = worldwide)", "Berlin, Texas, United Kingdom"],
  ["targetRoles", "Buyer roles / titles", "owner, founder, practice manager"],
  ["includeKeywords", "Demand keywords (signals they need you)", "outdated website, no online booking"],
  ["excludeKeywords", "Exclude leads containing", "franchise, government, university"],
  ["competitors", "Competitors to always exclude", "Acme Marketing, Example Agency"],
] as const;

const TOGGLES = [
  ["excludeAgencies", "Exclude marketing / web / digital agencies"],
  ["excludeTechCompanies", "Exclude software / AI / IT companies and individual developers/designers"],
  ["excludeRecruiters", "Exclude recruiters / HR"],
  ["excludeJuniorRoles", "Exclude students, interns, juniors, job seekers"],
  ["requireDemandSignal", "Require evidence they need your services before outreach"],
] as const;

export default async function BusinessProfilePage() {
  const profile = await loadBusinessProfile();
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Business Profile"
        description="Describe your business and ideal customer. Discovery queries, qualification, scoring and drafts all use this profile — you only see leads that match. Lists accept commas or new lines."
      />
      <form action={saveBusinessProfileAction} className="grid max-w-3xl gap-5">
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input id="businessName" name="businessName" defaultValue={profile.businessName} />
        </div>
        <div>
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" defaultValue={profile.website} />
        </div>
        <div>
          <Label htmlFor="description">What you do and for whom</Label>
          <Textarea id="description" name="description" defaultValue={profile.description} />
        </div>
        <div>
          <Label htmlFor="companySize">Target company size</Label>
          <Input id="companySize" name="companySize" defaultValue={profile.companySize} placeholder="1-50 employees" />
        </div>
        {LISTS.map(([key, label, placeholder]) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            <Textarea id={key} name={key} defaultValue={profile[key].join(", ")} placeholder={placeholder} />
          </div>
        ))}
        <div>
          <Label htmlFor="bookingUrl">Booking link (optional)</Label>
          <Input id="bookingUrl" name="bookingUrl" defaultValue={profile.bookingUrl} placeholder="https://cal.com/you/30min" />
        </div>
        <fieldset className="grid gap-2">
          {TOGGLES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={key} defaultChecked={profile[key]} /> {label}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit">Save profile</Button>
        </div>
      </form>
    </div>
  );
}

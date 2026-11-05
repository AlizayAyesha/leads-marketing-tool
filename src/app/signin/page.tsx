import { devSessionEnabled } from "@/lib/auth/config";
import { SignInPanel } from "@/components/auth/signin-panel";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignInPanel devEnabled={devSessionEnabled()} />;
}

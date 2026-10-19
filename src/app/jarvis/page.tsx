import { JarvisBar } from "@/components/jarvis/command-bar";
import { getOrCreateJarvisThread, listJarvisMessages } from "@/lib/jarvis/threads";

export const dynamic = "force-dynamic";

export default async function JarvisPage() {
  const thread = await getOrCreateJarvisThread().catch(() => null);
  const messages = thread
    ? await listJarvisMessages(thread.id).catch(() => [])
    : [];

  return (
    <JarvisBar
      threadId={thread?.id ?? null}
      messages={messages.map((row) => ({ id: row.id, role: row.role, content: row.content }))}
    />
  );
}

import { runWorkerTick } from "../src/lib/queue/worker-tick";

const intervalMs = Number(process.env.QUEUE_POLL_MS || 15_000);

async function tick() {
  const report = await runWorkerTick();
  console.log(JSON.stringify({ at: new Date().toISOString(), processed: report.processed, reclaimed: report.reclaimed, claims: report.claims }));
}

console.log("Jarvis queue worker started. Social automation is not invoked by this process.");
void tick();
setInterval(() => {
  void tick().catch((error) => {
    console.error(error instanceof Error ? error.message : "worker tick failed");
  });
}, intervalMs);

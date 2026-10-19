export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Load the saved Business Profile from Postgres into memory at server start.
    const { loadBusinessProfile } = await import("@/lib/business/store");
    await loadBusinessProfile();
  }
}

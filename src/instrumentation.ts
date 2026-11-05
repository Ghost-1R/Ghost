export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startInProcessMockWorker } = await import("./lib/agent-runtime/in-process-worker");
  startInProcessMockWorker();
}

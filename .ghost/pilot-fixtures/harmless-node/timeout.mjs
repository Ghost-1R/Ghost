// Deliberate long sleep for timeout/resource-limit pilot scenario.
const ms = Number(process.env.GHOST_PILOT_SLEEP_MS ?? "120000");
await new Promise((resolve) => setTimeout(resolve, ms));
console.log("TIMEOUT_SHOULD_NOT_REACH");

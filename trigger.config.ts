import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // ponytail: replace with the ref from your Trigger.dev project page (proj_...)
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REPLACE_ME",
  dirs: ["./src/trigger"],
  maxDuration: 600,
  retries: { enabledInDev: true, default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 60000 } },
});

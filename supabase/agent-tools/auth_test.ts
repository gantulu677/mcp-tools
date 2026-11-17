import { isValidBearerToken } from "./auth.ts";

const validSecret = "a".repeat(64);

Deno.test("rejects a missing Authorization header", async () => {
  if (await isValidBearerToken(undefined, validSecret)) {
    throw new Error("Expected missing credentials to be rejected.");
  }
});

Deno.test("rejects an unsupported authorization scheme", async () => {
  if (await isValidBearerToken("Basic abc123", validSecret)) {
    throw new Error("Expected unsupported scheme to be rejected.");
  }
});

Deno.test("rejects an empty bearer token", async () => {
  if (await isValidBearerToken("Bearer ", validSecret)) {
    throw new Error("Expected empty bearer token to be rejected.");
  }
});

Deno.test("rejects a missing or too-short configured secret", async () => {
  if (await isValidBearerToken("Bearer token", undefined)) {
    throw new Error("Expected missing configured secret to be rejected.");
  }
  if (await isValidBearerToken("Bearer token", "short")) {
    throw new Error("Expected short configured secret to be rejected.");
  }
});

Deno.test("rejects an incorrect bearer token", async () => {
  if (await isValidBearerToken("Bearer " + "b".repeat(64), validSecret)) {
    throw new Error("Expected incorrect credentials to be rejected.");
  }
});

Deno.test("accepts the configured bearer token", async () => {
  if (!await isValidBearerToken("Bearer " + validSecret, validSecret)) {
    throw new Error("Expected valid credentials to be accepted.");
  }
});

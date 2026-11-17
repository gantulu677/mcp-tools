# MCP Tools — Audit & Implementation Requirements

**Repository:** `gantulu677/mcp-tools`  
**Document version:** 1.0  
**Status:** Approved priorities — implementation in progress  
**Approved scope:** Audit findings and remediation priorities  
**Target branch for this document:** `main`

## 1. Purpose

This document records the approved audit findings and the implementation requirements for the ChatGPT Native + Custom MCP Server architecture. It is the source of truth for remediation work and must be updated as findings move through implementation and verification.

The audit distinguishes the current `main` branch from the feature branch `feature/chatgpt-native-agent-tools`. Findings observed only on the feature branch must be fixed and verified before that implementation is merged into `main`.

## 2. Architecture constraints

The following architecture is retained:

- ChatGPT Native performs reasoning, product selection, creative direction, prompt authoring, and native image generation.
- The Supabase Edge Function exposes MCP tools for data access, validation, image finalization, and persistence.
- The system must not call an external image-generation API.
- Supabase Postgres stores the product catalog and completed post metadata.
- Supabase Storage stores the original brand logo and finalized images.

Required MCP tools:

1. `list_products` — list active products.
2. `get_product_details` — retrieve complete specifications for one selected product.
3. `generate` — validate creative inputs and build a prompt; it does not generate an image.
4. `finalize_image` — validate a ChatGPT-generated image, overlay the original logo, and upload the final image.
5. `save_post` — persist creative metadata and the final public image URL.

Image requirements:

- Final output: PNG, 1080 × 1350 pixels, 4:5.
- Generate the image without a logo.
- Load the original logo from Storage object `apple/logo.png`.
- Overlay the original logo at the top-left, small size.
- Upload the finalized image to the public `image` bucket.
- Save the public URL and Storage path in `public.make_post`.

## 3. Priority definitions

| Priority | Definition | Required timing |
|---|---|---|
| P-0 | Critical blocker; prevents compilation, core workflow execution, or creates an immediate security/data-integrity risk | Fix before merge or deployment |
| P-1 | High; required for safe and reliable production deployment | Fix before production deployment |
| P-2 | Medium; important reliability, maintainability, or operational improvement | Schedule after P-0/P-1 |
| P-3 | Low; optimization or non-blocking enhancement | Backlog |

## 4. Approved audit findings and requirements

### P-0 — P0-001: Repair malformed `save_post` implementation

**Observed in:** `supabase/agent-tools/index.ts` on `feature/chatgpt-native-agent-tools`.

**Finding:** The reviewed source contains a duplicate declaration of `storedImage` / `storedImageError` and literal escaped newline sequences in the affected block. This is expected to cause a TypeScript parse or compile failure.

**Requirements:**
- Remove duplicate declarations.
- Remove unintended literal escape sequences and restore valid TypeScript line breaks.
- Keep exactly one Storage existence check for the finalized image.
- Preserve validation that the supplied product ID is active and matches the product name.
- Preserve validation that the image URL and Storage path refer to the expected finalized object in the `image` bucket.
- Ensure database insertion failures return a clear error and do not report success.

**Acceptance criteria:**
- Deno type-check succeeds.
- Edge Function starts in the local/test runtime.
- `save_post` succeeds for a valid finalized image and valid product.
- `save_post` rejects an invalid product reference, mismatched image URL/path, and missing Storage object.
- No duplicate variable declarations or malformed escaped source lines remain.

**Status:** In Progress — malformed `save_post` block repaired; validation extracted into a testable module. Deno type-check and 7 automated unit tests pass on the feature branch. Live Supabase/Edge Runtime integration tests remain pending.

### P-0 — P0-002: Require authentication on the deployed `agent-tools` Edge Function

**Observed in:** Supabase project `bkyqbbigfvfaobblxziu`, deployed Edge Function `agent-tools` version 6.

**Finding:** The deployed function has `verify_jwt = false`. Its deployed source contains no `AGENT_TOOLS_BEARER_TOKEN` check or other request-authentication middleware before exposing MCP tools. The function uses server-side Supabase credentials and exposes an `upload_image` tool that writes to Storage and `generated_images`. This creates an unauthenticated write surface if the function URL is reachable.

**Requirements:**
- Require a high-entropy bearer token or enable a suitable JWT verification strategy before any MCP tool can be invoked.
- Keep preflight `OPTIONS` handling separate from protected application routes; all non-preflight requests must be authenticated.
- Never expose the service-role/secret key to callers.
- Add automated tests proving missing, malformed, and incorrect credentials are rejected and valid credentials are accepted.
- Verify the deployed function configuration and source after an explicitly approved deployment.

**Acceptance criteria:**
- Unauthenticated requests cannot invoke read or write tools.
- Invalid bearer tokens receive an authorization failure.
- Authenticated requests can invoke only the intended tools.
- No privileged credential is returned to the caller or committed to source control.

**Status:** In Progress — bearer-token validation is isolated in `supabase/agent-tools/auth.ts`; 6 tests cover missing, malformed, empty, short/missing configured secret, incorrect, and valid credentials. The latest CI passed all 6 auth tests. The HTTP middleware is not yet exercised end-to-end, and deployed version 6 remains unchanged and unauthenticated; no production invocation or deployment was performed.

### P-1 — P1-001: Add automated validation in CI

**Finding:** No configured automated test workflow was confirmed during this audit.

**Requirements:**
- Add GitHub Actions workflow for relevant changes to the Edge Function, migrations, and configuration.
- Run Deno formatting/checking and type-checking.
- Run automated tests for input validation and critical workflow behavior where practical.
- Make failures visible on pull requests.
- Document any tests requiring Supabase credentials and keep secrets out of repository files.

**Acceptance criteria:**
- Pull requests run the validation workflow automatically.
- A failed type-check or test produces a failed workflow.
- No service-role key, bearer token, or other secret is committed.

**Status:** In Progress — latest GitHub Actions run passed Deno type-check, Deno lint, 6 bearer-token tests, and 7 `save_post` tests (13 total, 0 failures). A formatting check and live Supabase integration tests are not included.

### P-1 — P1-002: Verify Storage prerequisites and deployment configuration

**Finding:** The workflow depends on Storage bucket `apple`, object `apple/logo.png`, and output bucket `image`. The reviewed migrations do not provision or verify these prerequisites.

**Requirements:**
- Provide a repeatable pre-deployment check for both buckets and the logo object.
- Verify that the `image` bucket is public if the application relies on public URLs.
- Verify that the logo can be read by the server-side Edge Function credential.
- Fail with a clear actionable error when a prerequisite is missing.
- Document bucket setup and required access policy without exposing privileged credentials.
- Verify the Edge Function secret `AGENT_TOOLS_BEARER_TOKEN` is configured with sufficient entropy before deployment.

**Acceptance criteria:**
- A deployment checklist explicitly verifies both buckets, the logo object, output bucket visibility, and the bearer-token secret.
- Missing prerequisites are detected before a user workflow fails midway.
- No secret is stored in source control or exposed to client-side code.

**Status:** Partially verified — buckets `apple` and `image` are public and present, and `apple/logo.png` exists. The deployed function still lacks request authentication (tracked as P0-002); the bearer-token secret for the feature-branch implementation has not been verified.

### P-1 — P1-003: Seed and validate the product catalog

**Finding:** The migration creates `public.products`, but does not provide product records. An empty catalog means product discovery returns no selectable products.

**Requirements:**
- Define a repeatable, reviewable product-seeding process.
- Store product names, descriptions, features, and complete specifications in the appropriate columns.
- Ensure product names are unique and non-blank.
- Ensure only active products are offered by `list_products`.
- Ensure `get_product_details` returns the complete specifications for the selected product.
- Do not silently invent missing product specifications.

**Acceptance criteria:**
- The environment has an agreed initial product dataset before end-to-end acceptance.
- `list_products` returns active seeded products.
- `get_product_details` returns the selected product's full stored specifications.
- Inactive or unknown products cannot be used by the generation workflow.

**Status:** Pending.

### P-1 — P1-004: Reconcile deployed Edge Function with the approved MCP tool contract

**Observed in:** Deployed Supabase Edge Function `agent-tools` version 6 and feature branch `feature/chatgpt-native-agent-tools`.

**Finding:** The deployed version exposes the earlier `generate` / `upload_image` workflow and writes upload metadata to `generated_images`. The feature branch implements the approved `list_products`, `get_product_details`, `generate`, `finalize_image`, and `save_post` workflow using `products` and `make_post`. The deployed source therefore does not yet match the approved architecture.

**Requirements:**
- Keep the deployed version unchanged until P0 authentication and required CI checks are complete.
- Prepare a deployment checklist that verifies the five expected MCP tools and their schemas.
- Verify the deployed function reads/writes the intended tables and Storage buckets.
- Verify authentication, image finalization, logo overlay, and post persistence after an explicitly approved deployment.
- Do not deploy or migrate production without explicit user authorization.

**Acceptance criteria:**
- Deployed MCP tool list matches the approved five-tool contract.
- `finalize_image` uploads a 1080 × 1350 PNG with the original logo overlay.
- `save_post` persists metadata in `public.make_post`.
- No unintended writes occur in `public.generated_images`.
- Deployment and post-deployment verification are documented.

**Status:** Pending — deployed version 6 remains on the earlier workflow. No production deployment or invocation was performed.

### P-2 — P2-001: Maintain `updated_at` automatically

**Finding:** The reviewed table migration defines `updated_at`, but no update trigger was included in that migration.

**Requirements:**
- Add a reusable timestamp trigger function, or use an existing approved shared function.
- Attach the trigger to `products` and `make_post`.
- Ensure inserts and updates preserve expected timestamp semantics.

**Acceptance criteria:**
- Updating either table refreshes `updated_at`.
- Existing creation timestamps are not overwritten on update.

**Status:** Pending.

### P-2 — P2-002: Add image-processing tests and resource safeguards

**Finding:** The finalization workflow performs image decoding, resizing, logo compositing, and PNG encoding. These operations need explicit tests and bounded resource use.

**Requirements:**
- Test valid 4:5 input and reject unsupported or invalid image data.
- Test output dimensions of exactly 1080 × 1350.
- Test logo transparency, top-left placement, and configured small size.
- Test output MIME type and PNG encoding.
- Define and enforce a maximum accepted input size and reasonable processing limits.
- Ensure failures do not leave orphaned Storage objects.
- Verify the original logo is not modified.

**Acceptance criteria:**
- Tests cover valid, invalid, oversized, and wrong-aspect-ratio inputs.
- Final output is a valid PNG at exactly 1080 × 1350.
- Logo overlay matches the documented placement and sizing.
- Failed processing or upload does not leave an untracked finalized object.

**Status:** Pending.

## 5. Implementation sequence

1. Fix P0-001 and prove the Edge Function compiles.
2. Fix P0-002 and verify authentication tests before any deployment.
3. Implement P1-001 CI checks so subsequent changes are continuously validated.
4. Complete P1-002 Storage and secret preflight checks.
5. Implement P1-003 product seeding and catalog validation.
6. Reconcile and verify the deployed tool contract under P1-004 after explicit deployment approval.
7. Implement P2-001 timestamp triggers.
8. Implement P2-002 image-processing tests and resource safeguards.
9. Run end-to-end tests across all five MCP tools in an isolated, approved test environment.
10. Review the complete diff and merge the feature implementation into `main` only after required checks pass.

## 6. End-to-end acceptance checklist

- [ ] MCP server starts and exposes all five expected tools.
- [ ] Bearer-token authentication rejects missing and invalid tokens.
- [ ] `list_products` returns active products.
- [ ] `get_product_details` returns complete specifications.
- [ ] `generate` builds a prompt and does not call an image-generation API.
- [ ] ChatGPT Native can generate the image using the returned prompt.
- [ ] `finalize_image` validates the image, overlays the original logo, and uploads a 1080 × 1350 PNG.
- [ ] `save_post` validates the product and stored image, then persists the record in `make_post`.
- [ ] RLS and grants prevent direct access by `anon` and `authenticated` where intended.
- [ ] No secrets are committed or returned to the client.
- [ ] CI, type-check, and end-to-end checks pass.

## 7. Change management

- Keep finding IDs stable: `P0-001`, `P1-001`, and so on. Do not reuse IDs.
- Update each finding's status: Pending, In Progress, Blocked, or Completed.
- A finding may be marked Completed only when its acceptance criteria have been verified.
- Any change to priority, scope, or architecture must be recorded here with a rationale.
- This document records approved priorities; it does not authorize skipping code review, tests, or deployment safeguards.

## 8. Audit limitations

This audit includes repository and branch inspection, GitHub Actions results, read-only Supabase SQL metadata queries, Storage bucket/object metadata, and read-only inspection of deployed Edge Function version 6. No production writes, Storage uploads/deletes, Edge Function invocations, deployments, or local Deno execution were performed. Supabase Development Branch creation was not attempted further because the user declined any cost-bearing operation. Runtime behavior requiring writes remains unverified.

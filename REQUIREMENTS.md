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

**Status:** In Progress — malformed `save_post` block repaired and committed to the feature branch; Deno type-check passes on the updated feature-branch commit. Edge Runtime and `save_post` integration tests remain pending.

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

**Status:** In Progress — GitHub Actions workflow added on the feature branch; Deno type-check passed for the updated commit. Formatting checks and automated runtime/unit tests are not yet included.

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

**Status:** Pending.

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
2. Implement P1-001 CI checks so subsequent changes are continuously validated.
3. Implement P1-002 Storage and secret preflight checks.
4. Implement P1-003 product seeding and catalog validation.
5. Implement P2-001 timestamp triggers.
6. Implement P2-002 image-processing tests and resource safeguards.
7. Run end-to-end tests across all five MCP tools.
8. Review the complete diff and merge the feature implementation into `main` only after required checks pass.

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

This audit was based on repository metadata, branch comparison, the reviewed Edge Function source, migration files, and README/configuration content available during the review. No live Supabase database inspection, deployed-function verification, or local Deno execution was performed as part of this audit. Items requiring runtime confirmation must remain pending until tested.

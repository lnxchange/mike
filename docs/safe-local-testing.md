# Safe Local Testing

Mike is a young open-source legal AI project. Until you have reviewed your
deployment and data flows, test it with disposable infrastructure and synthetic
documents only.

## Use Disposable Test Resources

Create separate test resources for Mike:

- a throwaway Supabase project
- a throwaway S3-compatible storage bucket, such as Cloudflare R2
- disposable model-provider API keys with low spending limits
- a test email account

Do not use production Supabase projects, production storage buckets, firm API
keys, or real client documents for initial testing.

## Where Uploaded Files Live

Mike does not use Supabase Storage. Uploaded documents, generated documents, and document
versions are written to an S3-compatible bucket via `backend/src/lib/storage.ts`, using
whichever endpoint `R2_ENDPOINT_URL` points at (Cloudflare R2 by default; a local MinIO
instance or any other S3-compatible provider also works — this is entirely
environment-driven, see `backend/.env.example`). Object keys are namespaced by user and
document ID, for example:

```
documents/<userId>/<docId>/source.pdf
documents/<userId>/<docId>/versions/<versionSlug>.docx
generated/<userId>/<docId>/generated.docx
```

Postgres (Supabase) only stores metadata about these files (filename, size, status, the
storage key) — never the file bytes themselves. If `R2_ENDPOINT_URL` /
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` are not set, uploads/downloads are disabled
(`storageEnabled` is `false` in `backend/src/lib/storage.ts`) but the rest of the app still
runs — useful for testing everything except document flows before setting up a bucket.

For local/test deployments, point `R2_ENDPOINT_URL` at a disposable bucket (a throwaway R2
bucket, or a local MinIO container) so test documents never land in a bucket you also use
for anything real. Because the storage client is a plain S3-compatible client with no
provider-specific code paths, swapping to a different provider later (including a future
mode.law-managed bucket) only requires changing these four environment variables — no code
changes.

## Keep Secrets Out of the Frontend

Only variables prefixed with `NEXT_PUBLIC_` should be assumed safe to expose to
the browser. Service-role keys and model-provider keys should stay server-side.

For frontend testing, `frontend/.env.local` should normally contain only:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Keep the Supabase service-role key in `backend/.env` only:

```env
SUPABASE_SECRET_KEY=your-supabase-service-role-key
```

Model-provider keys such as `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and
`OPENROUTER_API_KEY` should also stay in `backend/.env`.

## Test With Synthetic Documents

Use fake or public sample documents when testing:

- synthetic NDAs
- sample contracts
- public court documents
- dummy PDF/DOCX files

Do not upload privileged, confidential, client, matter, personnel, or firm
knowledge-management material until you are comfortable with the deployment's
storage, logging, deletion, and model-provider behavior.

## Confirm Environment Files Are Not Tracked

Before running or committing changes, check:

```bash
git status --short
```

Stop if `.env`, `.env.local`, or any file containing secrets appears in the
output.

## Start With Non-LLM Flows

If you do not want to use model-provider keys yet, use dummy provider values and
test only the non-LLM flows first:

- account creation against a test Supabase project
- project creation
- file upload with synthetic documents
- folder organization
- document deletion

Then add one disposable, capped model-provider key and test assistant behavior
with synthetic documents.

## Clean Up After Testing

After testing, delete:

- uploaded objects from the storage bucket
- test Supabase rows or the whole test Supabase project
- disposable model-provider keys
- local `.env` files that contain secrets

For legal-document workflows, deletion semantics matter. Verify that your
storage bucket no longer contains test document objects after delete flows.

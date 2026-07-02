# Quickstart: fresh Supabase + Vercel test deployment

One linear runbook: create accounts/projects, get every key, put them in the right place,
and end up with a working deployment (or a working local dev setup, or both). This ties
together `SUPABASE_SETUP.md`, `README.md`'s Vercel section, and the `.env.example` files
into one ordered checklist — read those files for the "why", this file is the "do this,
in this order."

Total external accounts needed: **Supabase**, **Vercel**, and one backend host (this guide
uses **Railway** as the example since `backend/nixpacks.toml` already targets it — Render/
Fly/a VM work too, see `README.md` "Why the backend isn't on Vercel"). Plus at least one
LLM provider (Anthropic, Google Gemini, or OpenAI).

You can stop after **Part 2** if you only want to run the app locally. Do **Part 3–5** if
you want a real Vercel + hosted-backend test deployment too.

---

## Part 0 — Generate two secrets up front

You'll need these later; generate them now so you're not blocked mid-setup:

```bash
openssl rand -hex 32   # use for DOWNLOAD_SIGNING_SECRET
openssl rand -hex 32   # use for USER_API_KEYS_ENCRYPTION_SECRET
```

Run it twice (or once and note you need two different values) and save both outputs
somewhere temporary — you'll paste them into `backend/.env` (and later Railway) in Part 2.

---

## Part 1 — Supabase project (database + auth)

1. Go to [supabase.com](https://supabase.com/) → sign up / log in → **New Project**.
   - Any name/region is fine. Use a disposable project for testing, not a production one.
   - Set a database password (Supabase generates one if you don't) — you won't need it
     for this app (only the API keys below matter), but save it anyway.
   - Wait ~1–2 minutes for provisioning.
2. Apply the schema: open the project → left sidebar → **SQL Editor** → **New query**.
   Open `backend/schema.sql` from this repo, copy the entire file, paste it into the query
   editor, and click **Run**. You should see "Success. No rows returned." This creates all
   tables, RLS policies, and the signup trigger — nothing else is needed for a fresh
   project (no seed data, no Storage buckets — this app doesn't use Supabase Storage).
3. Get your keys: left sidebar → **Project Settings** (gear icon) → **API**. You need three
   values from this page:

   | On the Supabase page | Copy it as | Goes into |
   |---|---|---|
   | **Project URL** | your Supabase URL | `SUPABASE_URL` (backend) and `NEXT_PUBLIC_SUPABASE_URL` (frontend) |
   | **anon** / **public** key | your anon key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (frontend) |
   | **service_role** key | your service role key | `SUPABASE_SECRET_KEY` (backend, and optionally frontend) |

   If the page shows newer key formats (`sb_publishable_...` / `sb_secret_...`) alongside
   older JWT-style keys, use the **legacy JWT-style** anon and service role keys — that's
   what this app's Supabase client libraries expect.

   ⚠️ The **service_role** key bypasses all database security. Never put it anywhere
   prefixed `NEXT_PUBLIC_`, never commit it, never share it.

4. (Recommended for testing) Turn off email confirmation so signup doesn't need a real
   inbox: **Authentication** → **Providers** → **Email** → turn off **Confirm email**.

You now have three values: **Project URL**, **anon key**, **service_role key**. Keep this
tab open, you'll paste these in Part 2.

---

## Part 2 — Local `.env` files (do this even if you're also deploying)

From the repo root:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Edit **`backend/.env`** and fill in:

```bash
SUPABASE_URL=<Project URL from Part 1>
SUPABASE_SECRET_KEY=<service_role key from Part 1>
DOWNLOAD_SIGNING_SECRET=<first openssl value from Part 0>
USER_API_KEYS_ENCRYPTION_SECRET=<second openssl value from Part 0>

# at least one of these three (get a key from the provider's own dashboard):
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Leave `PORT`, `FRONTEND_URL`, and the `R2_*` storage vars as-is for now — storage is
optional to start (uploads/downloads just stay disabled until you set it up; see
`docs/safe-local-testing.md` if you want a test R2/MinIO bucket).

Edit **`frontend/.env.local`** and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=<same Project URL as above>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=<anon key from Part 1>
SUPABASE_SECRET_KEY=<same service_role key as above>
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Now verify Supabase is wired up correctly before touching the app:

```bash
npm install --prefix backend   # first time only
npm run check:supabase --prefix backend
```

You should see `[PASS]` on every line and `All required checks passed.` at the bottom. If
anything fails, the message tells you exactly what to fix (see `SUPABASE_SETUP.md`).

Then run it locally:

```bash
npm install --prefix frontend   # first time only
npm run dev --prefix backend    # terminal 1
npm run dev --prefix frontend   # terminal 2
```

Open `http://localhost:3000`, sign up, and you're testing against your real Supabase
project locally. **If you only wanted local testing, you're done — skip to the bottom
"Verify" checklist.**

---

## Part 3 — Deploy the backend (Railway example)

The Express backend needs a host that runs a long-lived Node process with LibreOffice
available — it does not run on Vercel (see `README.md` "Why the backend isn't on Vercel").
Railway is used here because `backend/nixpacks.toml` already configures it.

1. Go to [railway.app](https://railway.app/) → sign up (GitHub login is easiest since your
   fork is already on GitHub) → **New Project** → **Deploy from GitHub repo** → pick this
   repo.
2. Railway will try to build the whole repo; tell it to only build the backend:
   - Open the new service → **Settings** → **Source** → set **Root Directory** to
     `backend`.
   - Under **Settings** → **Build**, Railway should auto-detect Nixpacks (it reads
     `backend/nixpacks.toml`, which installs LibreOffice) and use `npm run build` /
     `npm run start` from `backend/package.json` automatically. If it doesn't
     auto-detect, set **Build Command** to `npm run build` and **Start Command** to
     `npm run start`.
3. Add environment variables: service → **Variables** → add every value from
   `backend/.env` that you filled in during Part 2 (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `DOWNLOAD_SIGNING_SECRET`, `USER_API_KEYS_ENCRYPTION_SECRET`, your model provider key(s),
   and the `R2_*` storage vars if you have them). Leave `FRONTEND_URL` for a moment — you
   don't have the Vercel URL yet; set it to `http://localhost:3000` for now and you'll
   update it in Part 5.
4. Deploy. Once it's up, go to **Settings** → **Networking** → **Generate Domain** to get a
   public URL (something like `https://your-backend.up.railway.app`).
5. Confirm it's alive: `curl https://your-backend.up.railway.app/health` should return
   `{"ok":true}`.

Keep that public backend URL — you need it in Part 4.

---

## Part 4 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com/) → sign up / log in → **Add New...** → **Project**
   → import this repo (connect GitHub if this is your first Vercel project).
2. Before deploying, set **Root Directory** to `frontend` (in the import screen, or later
   under **Settings** → **General** → **Root Directory**). This repo has no root
   `package.json`, so Vercel must be pointed at `frontend/` to detect Next.js correctly.
   Framework Preset should auto-detect as **Next.js**; the install/build commands are
   already pinned to `npm` via `frontend/vercel.json`, so you shouldn't need to touch them.
3. Add environment variables (**Settings** → **Environment Variables**, or in the import
   screen) — add each for both **Preview** and **Production** so preview deployments work
   too:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Part 1 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | anon key from Part 1 |
   | `SUPABASE_SECRET_KEY` | service_role key from Part 1 |
   | `NEXT_PUBLIC_API_BASE_URL` | the Railway backend URL from Part 3 |

4. Click **Deploy**. When it finishes, Vercel gives you a URL like
   `https://your-app.vercel.app` (and a distinct URL per preview deployment).

---

## Part 5 — Close the loop (CORS)

Go back to Railway → your backend service → **Variables** → set `FRONTEND_URL` to your
real Vercel URL from Part 4 (e.g. `https://your-app.vercel.app`), then redeploy the backend
service (Railway usually redeploys automatically when a variable changes). This is what
allows the deployed frontend's browser requests to pass the backend's CORS check.

---

## Verify everything end to end

1. `npm run check:supabase --prefix backend` (locally, using your `backend/.env`) — all
   `[PASS]`.
2. Open your Vercel URL → sign up with a test email → you should land on `/assistant`.
3. Create a project, upload a synthetic test document (see
   `docs/safe-local-testing.md` — don't upload anything sensitive to a test deployment).
4. If you set a model provider key, ask the assistant a question about the uploaded
   document and confirm you get a streamed response with citations.
5. If something fails, check: Railway service logs (backend errors), Vercel deployment
   logs / function logs (frontend build or runtime errors), and browser dev tools Network
   tab (CORS or 401 errors usually mean a mismatched `FRONTEND_URL` or a wrong Supabase key).

---

## Giving these credentials to a Cursor Cloud Agent (optional)

If you want a Cursor Cloud Agent (like the one that made this change) to run this same
verification for you automatically in a future task, don't paste secrets into chat or
commit them. Instead, add them in **Cursor Dashboard → Cloud Agents → Secrets** as
environment variables using the exact names above (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`,
`NEXT_PUBLIC_API_BASE_URL`, model provider keys, etc.). They're injected as environment
variables into new Cloud Agent VMs and are never shown back to you in chat.

## Related docs

- `SUPABASE_SETUP.md` — deeper detail on the schema, access model, and existing-database
  guidance.
- `README.md` — the same Vercel/backend-hosting explanation in narrative form, plus local
  dev scripts.
- `docs/safe-local-testing.md` — why to use disposable resources and synthetic documents
  for this kind of testing.
- `backend/.env.example`, `frontend/.env.local.example` — the authoritative, fully
  commented list of every variable.

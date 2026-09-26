# Shikhar Commodities — DC Generator

A static web app for creating and tracking Delivery Challans, backed by a
real Supabase (Postgres) database instead of a hardcoded JSONBin key.

## What changed from the old version

The previous version stored everything in JSONBin.io with the **master API
key hardcoded in the public page source** — anyone who viewed the page
source could read, edit, or delete all company data, and a `FREEZE_MODE`
flag left in the code had frozen all data entry.

This version:
- Stores data in a real Postgres database (Supabase project `shikhar-dc-generator`, org "Ayatti Coal").
- Uses Supabase's public **anon/publishable key** in the client, which is safe
  to expose — it can only do what the database's Row Level Security (RLS)
  policies allow.
- Requires **login** to read or write any data (RLS policies only allow the
  `authenticated` role). Nothing is publicly readable or writable anymore.
- Generates DC numbers atomically via a database function
  (`next_dc_number`), so two people saving at the same time can never get a
  duplicate or clashing number (the old version's in-browser counter could
  race).
- Historical data (parties, POs, challans, DC-number counters, company
  details) was migrated in from the old JSONBin data.

## One-time setup required (do this before staff use it)

### 1. Disable public sign-ups
By default Supabase allows anyone to self-register. Since this is a private
office tool, turn that off:
- Supabase Dashboard → your project → **Authentication → Sign In / Providers → Email**
- Turn **off** "Allow new users to sign up".

### 2. Create the shared office login
- Supabase Dashboard → **Authentication → Users → Add user**
- Enter the email + password your office will use to sign in.
- Tick "Auto Confirm User" so no confirmation email is needed.
- Share these credentials with whoever needs to use the app.

(This is the "one shared office login" you asked for. To move to per-person
logins later, just add more users the same way — no code changes needed.)

### 3. Connect Netlify for auto-deploy
- Netlify → Add new site → Import an existing project → connect to
  `volarisstudio-stack/shikhar-dc-generator` on GitHub.
- Build command: (leave blank) — Publish directory: `.`
- Deploy. Every push to `main` will now redeploy automatically.

## Project structure

```
index.html        Page markup (login screen + app shell)
css/style.css      Styling
js/config.js       Public Supabase URL + anon key
js/app.js          All app logic (auth, CRUD, PDF preview/print, CSV export)
supabase/          Reference copy of the schema (see below)
```

## Database

Project ref: `nkqjziglmefagjndeueu` (Supabase org "Ayatti Coal").

Tables: `company`, `parties`, `purchase_orders`, `saudas`, `challans`,
`dc_counters`. All have RLS enabled with a single "authenticated full
access" policy — only signed-in users can read or write.

`next_dc_number(po_number)` is a Postgres function that atomically bumps
`dc_counters` and returns the next `NN-<last 3 digits of PO>` style number,
matching the old numbering scheme.

## Local development

This is a plain static site — no build step. Open `index.html` directly,
or serve the folder with any static file server.

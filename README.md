# NavQR

NavQR is a Svelte 5 SaaS app that lets users:

- Enter a location name/address
- Generate a shareable redirect link (`/r/<slug>`)
- Generate a QR code for the link
- Optionally sign in with Google or one-time email links
- Store and view private generated links in Supabase (scoped to each user)
- Use the top-right user icon dropdown to access sign in/account pages
- Use a dedicated `/auth` page for sign in and registration

## Tech stack

- SvelteKit (Svelte 5)
- Tailwind CSS
- shadcn-svelte components
- Supabase (Postgres backend)
- Google Maps Places API (address autocomplete)

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Create your env file:

```bash
cp .env.example .env
```

3. Fill in values in `.env`:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_GOOGLE_MAPS_API_KEY`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (required for redirect route lookups when RLS is enabled)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Optional Stripe pricing overrides:

- `STRIPE_PRO_MONTHLY_AMOUNT` (defaults to `1200`, amount in cents)
- `STRIPE_TEAM_MONTHLY_AMOUNT` (defaults to `3900`, amount in cents)

Google key requirements:

- Enable `Maps JavaScript API` and `Places API` in your Google Cloud project
- Restrict the key to your app origins where possible

4. Create the DB table/policies in Supabase:

- Run SQL from:
  - `supabase/migrations/20260309180000_create_links.sql`
  - `supabase/migrations/20260310090000_links_private_listing.sql`

5. Enable auth providers in Supabase Auth:

- Google provider (for "Sign in with Google")
- Email provider (for one-time email link sign-in)
- In Google Cloud OAuth client, add authorized redirect URI:
  - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
- In Supabase Auth URL configuration (Site URL / Redirect URLs), allow:
  - Local: `http://localhost:4173/auth/callback`
  - Production: `https://YOUR_DOMAIN/auth/callback`

6. Start the app:

```bash
pnpm dev
```

## Stripe billing

- Account upgrades use Stripe Checkout subscriptions.
- Paid-plan changes are synced back to `user_profiles.plan_tier` through the webhook endpoint:
  - `/api/stripe/webhook`
- Configure that webhook in Stripe and subscribe it to:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

## Scripts

- `pnpm dev` - start local development server
- `pnpm check` - run Svelte/TypeScript checks
- `pnpm build` - production build
- `pnpm preview` - preview production build

## Redirect behavior

Short link route: `/r/<slug>`

- iOS user-agent: redirects to `maps://` Apple Maps URL
- Non-iOS user-agent: redirects to Google Maps URL

## Data privacy

- The app no longer shows global/public recent links.
- Signed-in users can only list links where `links.user_id = auth.uid()`.
- Anonymous users can still generate short links, but those links are not listed in any public feed.

## Deployment note

This app now has server-side routes/actions and a Supabase backend, so GitHub Pages static hosting is not the right target anymore. Deploy to a SvelteKit-compatible host (for example Vercel, Netlify, Cloudflare, or Node hosting).

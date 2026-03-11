alter table public.user_profiles
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists stripe_subscription_status text,
add column if not exists stripe_price_id text,
add column if not exists stripe_current_period_end timestamptz;

create unique index if not exists user_profiles_stripe_customer_id_key
on public.user_profiles (stripe_customer_id)
where stripe_customer_id is not null;

create index if not exists user_profiles_stripe_subscription_id_idx
on public.user_profiles (stripe_subscription_id)
where stripe_subscription_id is not null;

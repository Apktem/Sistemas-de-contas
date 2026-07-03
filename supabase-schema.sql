create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  cpf_hash text unique,
  identifier_type text not null check (identifier_type in ('email', 'cpf')),
  identifier_label text not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((email is not null) <> (cpf_hash is not null))
);

alter table public.users add column if not exists name text;
alter table public.users add column if not exists avatar_data text;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  profile text not null check (profile in ('Casa', 'Empresa')),
  category text not null,
  status text not null check (status in ('pending', 'paid')),
  created_at timestamptz not null default now()
);

create index if not exists bills_user_date_idx on public.bills(user_id, due_date);

alter table public.bills add column if not exists tags text[] not null default '{}';
alter table public.bills add column if not exists series_id uuid;
alter table public.bills add column if not exists series_type text not null default 'single';
alter table public.bills add column if not exists installment_number integer;
alter table public.bills add column if not exists installment_total integer;

create index if not exists bills_series_idx on public.bills(series_id);

create table if not exists public.monthly_incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  profile text not null check (profile in ('Casa', 'Empresa')),
  amount numeric(12,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, month, profile)
);

create index if not exists monthly_incomes_user_month_idx on public.monthly_incomes(user_id, month);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  credit_limit numeric(12,2) not null check (credit_limit > 0),
  close_day integer not null check (close_day between 1 and 31),
  due_day integer not null check (due_day between 1 and 31),
  profile text not null check (profile in ('Casa', 'Empresa')),
  created_at timestamptz not null default now()
);

create index if not exists cards_user_idx on public.cards(user_id);

create table if not exists public.subscriptions (
  user_id uuid primary key references public.users(id) on delete cascade,
  provider_id text not null unique,
  payer_email text,
  status text not null default 'pending',
  next_payment_date timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_status_idx on public.subscriptions(status);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_user_idx on public.password_reset_tokens(user_id);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  push_enabled boolean not null default false,
  reminder_days integer not null default 2 check (reminder_days between 1 and 30),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences add column if not exists push_enabled boolean not null default false;
alter table public.notification_preferences drop column if exists whatsapp_phone;
alter table public.notification_preferences drop column if exists whatsapp_enabled;
alter table public.notification_preferences drop column if exists consent_at;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  channel text not null default 'push',
  scheduled_for date not null,
  status text not null,
  provider_message_id text,
  error text,
  updated_at timestamptz not null default now(),
  unique (bill_id, channel, scheduled_for)
);

delete from public.notification_deliveries where channel = 'whatsapp';

alter table public.users enable row level security;
alter table public.bills enable row level security;
alter table public.cards enable row level security;
alter table public.monthly_incomes enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.password_reset_tokens enable row level security;

revoke all on public.users, public.bills, public.cards, public.monthly_incomes, public.subscriptions, public.notification_preferences, public.notification_deliveries, public.push_subscriptions from anon, authenticated;
revoke all on public.password_reset_tokens from anon, authenticated;

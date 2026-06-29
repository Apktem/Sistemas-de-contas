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

alter table public.users enable row level security;
alter table public.bills enable row level security;
alter table public.cards enable row level security;

revoke all on public.users, public.bills, public.cards from anon, authenticated;

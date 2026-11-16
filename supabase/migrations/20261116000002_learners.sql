-- Learner side: accounts, family profiles, per-item progress, answer events. ROADMAP §3.2 / §3.4.

create type public.learner_type as enum ('kid', 'adult');

create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',           -- free | premium | family (entitlements come from RevenueCat)
  store_customer_id text,
  created_at timestamptz not null default now()
);

create table public.learners (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  avatar text not null default '🙂',
  type public.learner_type not null default 'kid',
  settings jsonb not null default '{}',
  unlocked int not null default 1,
  unlocked_at timestamptz,
  placement jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learners_account_idx on public.learners (account_id);

-- mirrors packages/core ItemState
create table public.item_progress (
  learner_id uuid not null references public.learners (id) on delete cascade,
  item_id uuid not null references public.items (id),
  box smallint not null default 0,
  due timestamptz,
  seen int not null default 0,
  right_count int not null default 0,
  wrong_count int not null default 0,
  streak int not null default 0,
  days date[] not null default '{}',           -- last 8 distinct practice days
  last timestamptz,
  intro boolean not null default false,
  box_day date,
  gains_today smallint not null default 0,
  writes int not null default 0,
  ever_mastered boolean not null default false,
  last_wrong timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, item_id)
);
create index item_progress_due_idx on public.item_progress (learner_id, due);

-- one row per learner per local calendar day: answers (streak) and XP (daily goal)
create table public.learner_days (
  learner_id uuid not null references public.learners (id) on delete cascade,
  day date not null,
  answers int not null default 0,
  xp int not null default 0,
  primary key (learner_id, day)
);

-- raw answer log: feeds analytics and the future review model
create table public.events (
  id bigint generated always as identity primary key,
  learner_id uuid not null references public.learners (id) on delete cascade,
  type text not null,                          -- answer | intro | session_start | session_end …
  item_id uuid references public.items (id),
  exercise text,
  correct boolean,
  is_review boolean,
  ms int,
  at timestamptz not null default now()
);
create index events_learner_idx on public.events (learner_id, at desc);
create index events_item_idx on public.events (item_id, at desc);

-- up to 6 learner profiles per account
create function app.learners_limit() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.learners l where l.account_id = new.account_id) >= 6 then
    raise exception 'An account can have at most 6 learner profiles' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger learners_limit before insert on public.learners for each row execute function app.learners_limit();

create function app.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger learners_touch before update on public.learners for each row execute function app.touch_updated_at();
create trigger item_progress_touch before update on public.item_progress for each row execute function app.touch_updated_at();

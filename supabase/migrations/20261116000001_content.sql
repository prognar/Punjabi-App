-- Content Studio schema: items, reviews, recordings, curriculum, releases, audit log.
-- ROADMAP §3.3 / §3.4.

create schema if not exists app;  -- helper functions (not exposed through the API)

create type public.studio_role as enum ('owner', 'admin', 'editor', 'reviewer', 'religious_reviewer', 'voice_talent', 'teacher');
create type public.item_kind as enum ('letter', 'vocab', 'phrase', 'sentence', 'conversation', 'story_line');
create type public.item_status as enum (
  'draft', 'in_review', 'changes_requested', 'approved_text', 'recording', 'approved_audio', 'ready', 'published', 'retired');
create type public.review_field as enum ('pa', 'en', 'rom', 'alts', 'gender_note', 'cultural_fit');
create type public.review_verdict as enum ('ok', 'change');
create type public.recording_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------- studio users
create table public.studio_users (
  id uuid primary key references auth.users (id) on delete cascade,
  roles public.studio_role[] not null default '{}',
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- items
create table public.items (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                       -- prototype slug id (l1, v-age, p-thank-you, s12, c3…); never changes
  kind public.item_kind not null,
  en text not null default '',
  pa text not null default '',
  rom text not null default '',
  pa_alts text[] not null default '{}',
  rom_alts text[] not null default '{}',
  note text not null default '',
  gender_forms jsonb,
  category text,
  phrase_group text,
  tags text[] not null default '{}',
  level text,
  source text not null default 'admin',        -- teacher | generated | admin
  data jsonb not null default '{}',            -- kind-specific: letter name/sound/words, sentence tokens/gloss/blank, conversation reply…
  status public.item_status not null default 'draft',
  version int not null default 1,              -- bumps when a language field changes; reviews are per version
  pa_version int not null default 1,           -- bumps when the Gurmukhi changes; recordings are per pa_version
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_kind_status_idx on public.items (kind, status);
create index items_tags_idx on public.items using gin (tags);

-- which card(s) a sentence / conversation practises
create table public.item_focus (
  item_id uuid not null references public.items (id) on delete cascade,
  focus_item_id uuid not null references public.items (id) on delete cascade,
  primary key (item_id, focus_item_id)
);
create index item_focus_focus_idx on public.item_focus (focus_item_id);

-- ---------------------------------------------------------------- review
create table public.item_field_reviews (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  field public.review_field not null,
  reviewer_id uuid not null references auth.users (id),
  verdict public.review_verdict not null,
  comment text not null default '',
  item_version int not null,
  at timestamptz not null default now()
);
create index item_field_reviews_item_idx on public.item_field_reviews (item_id, item_version, field, at desc);

create table public.comments (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  body text not null,
  resolved boolean not null default false,
  at timestamptz not null default now()
);
create index comments_item_idx on public.comments (item_id, at);

-- ---------------------------------------------------------------- recordings
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  speaker_id uuid not null references auth.users (id),
  take_no int not null default 0,              -- assigned by trigger
  storage_path text not null,
  original_path text,                          -- untouched WAV
  duration_ms int,
  lufs numeric,
  is_slow boolean not null default false,
  voice text,                                  -- e.g. female-adult, male-adult, child
  pa_version int not null default 0,           -- assigned by trigger
  status public.recording_status not null default 'pending',
  is_best boolean not null default false,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, speaker_id, is_slow, take_no)
);
create index recordings_item_idx on public.recordings (item_id, status);
create unique index recordings_one_best_idx on public.recordings (item_id, is_slow, coalesce(voice, '')) where is_best;

-- ---------------------------------------------------------------- curriculum
create table public.units (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  can_do text not null default '',             -- the real-world task ("Greet elders")
  level text,
  sort_order int not null default 0
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units (id) on delete set null,
  legacy_n int unique,                         -- prototype lesson number
  title text not null default '',
  sort_order int not null default 0
);
create table public.lesson_items (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  sort_order int not null default 0,
  primary key (lesson_id, item_id)
);
create index lesson_items_item_idx on public.lesson_items (item_id);

-- ---------------------------------------------------------------- releases
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  notes text not null default '',
  published_by uuid references auth.users (id),
  at timestamptz not null default now()
);
create table public.release_items (
  release_id uuid not null references public.releases (id) on delete cascade,
  item_id uuid not null references public.items (id),
  item_version int not null,
  recording_id uuid references public.recordings (id),
  slow_recording_id uuid references public.recordings (id),
  primary key (release_id, item_id)
);

-- ---------------------------------------------------------------- audit
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);

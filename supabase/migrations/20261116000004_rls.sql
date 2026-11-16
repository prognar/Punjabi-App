-- Row-level security. Studio tables: any studio user reads; writes by role. Learner tables: only the owning account.
-- Learner apps never read the studio tables — they download published content packs.

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on function public.publish_release(text, text) from public, anon;
grant execute on function public.publish_release(text, text) to authenticated;

alter table public.studio_users enable row level security;
alter table public.items enable row level security;
alter table public.item_focus enable row level security;
alter table public.item_field_reviews enable row level security;
alter table public.comments enable row level security;
alter table public.recordings enable row level security;
alter table public.units enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_items enable row level security;
alter table public.releases enable row level security;
alter table public.release_items enable row level security;
alter table public.audit_log enable row level security;
alter table public.accounts enable row level security;
alter table public.learners enable row level security;
alter table public.item_progress enable row level security;
alter table public.learner_days enable row level security;
alter table public.events enable row level security;

-- ---------------------------------------------------------------- studio
create policy studio_users_read on public.studio_users for select to authenticated using (app.is_studio() or id = (select auth.uid()));
create policy studio_users_admin on public.studio_users for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy items_read on public.items for select to authenticated using (app.is_studio());
create policy items_insert on public.items for insert to authenticated with check (app.has_role('owner', 'admin', 'editor'));
create policy items_update on public.items for update to authenticated using (app.has_role('owner', 'admin', 'editor')) with check (app.has_role('owner', 'admin', 'editor'));

create policy item_focus_read on public.item_focus for select to authenticated using (app.is_studio());
create policy item_focus_write on public.item_focus for all to authenticated using (app.has_role('owner', 'admin', 'editor')) with check (app.has_role('owner', 'admin', 'editor'));

create policy reviews_read on public.item_field_reviews for select to authenticated using (app.is_studio());
create policy reviews_insert on public.item_field_reviews for insert to authenticated
  with check (reviewer_id = (select auth.uid()) and app.has_role('owner', 'admin', 'reviewer', 'religious_reviewer'));

create policy comments_read on public.comments for select to authenticated using (app.is_studio());
create policy comments_insert on public.comments for insert to authenticated with check (user_id = (select auth.uid()) and app.is_studio());
create policy comments_update on public.comments for update to authenticated using (app.is_studio()) with check (app.is_studio());

create policy recordings_read on public.recordings for select to authenticated using (app.is_studio());
create policy recordings_insert on public.recordings for insert to authenticated
  with check (speaker_id = (select auth.uid()) and app.has_role('owner', 'admin', 'voice_talent'));
create policy recordings_update on public.recordings for update to authenticated
  using (app.has_role('owner', 'admin', 'reviewer', 'religious_reviewer')) with check (app.has_role('owner', 'admin', 'reviewer', 'religious_reviewer'));

create policy units_read on public.units for select to authenticated using (app.is_studio());
create policy units_write on public.units for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy lessons_read on public.lessons for select to authenticated using (app.is_studio());
create policy lessons_write on public.lessons for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy lesson_items_read on public.lesson_items for select to authenticated using (app.is_studio());
create policy lesson_items_write on public.lesson_items for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy releases_read on public.releases for select to authenticated using (app.is_studio());
create policy release_items_read on public.release_items for select to authenticated using (app.is_studio());
-- releases are written only by publish_release()

create policy audit_read on public.audit_log for select to authenticated using (app.is_admin());
-- audit_log is written only by triggers

-- ---------------------------------------------------------------- learners
create policy accounts_own on public.accounts for select to authenticated using (id = (select auth.uid()));
create policy accounts_insert on public.accounts for insert to authenticated with check (id = (select auth.uid()) and plan = 'free');
create policy accounts_delete on public.accounts for delete to authenticated using (id = (select auth.uid()));
-- plan / store_customer_id are changed only by the service role (RevenueCat webhook)

create policy learners_own on public.learners for all to authenticated
  using (account_id = (select auth.uid())) with check (account_id = (select auth.uid()));

create function app.owns_learner(l uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.learners x where x.id = l and x.account_id = (select auth.uid()))
$$;
grant execute on function app.owns_learner(uuid) to authenticated;

create policy item_progress_own on public.item_progress for all to authenticated using (app.owns_learner(learner_id)) with check (app.owns_learner(learner_id));
create policy learner_days_own on public.learner_days for all to authenticated using (app.owns_learner(learner_id)) with check (app.owns_learner(learner_id));
create policy events_read on public.events for select to authenticated using (app.owns_learner(learner_id));
create policy events_insert on public.events for insert to authenticated with check (app.owns_learner(learner_id));

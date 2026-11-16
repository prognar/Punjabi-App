-- Item lifecycle rules, enforced in the database so every client behaves the same:
--   draft → in_review → changes_requested ⟲ → approved_text → recording → approved_audio → ready → published
-- * every language field needs an ✓ from a reviewer at the current version before approved_text
-- * items tagged gurbani / gurdwara also need an ✓ from a religious reviewer
-- * editing a language field after approval sends the item back to in_review
-- * a recording is approved by someone other than the speaker
-- * items are never deleted (retire instead) and legacy_id never changes

-- ---------------------------------------------------------------- role helpers
create function app.has_role(variadic r public.studio_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_users u where u.id = (select auth.uid()) and u.roles && r)
$$;
create function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'admin')
$$;
create function app.is_studio() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_users u where u.id = (select auth.uid()))
$$;

-- ---------------------------------------------------------------- items
create function app.items_before_write() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  text_changed boolean;
  by_user boolean := (select auth.uid()) is not null and pg_trigger_depth() = 1;  -- a direct edit, not a workflow trigger / service role
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := (select auth.uid()); end if;
    if by_user and not app.is_admin() then new.status := 'draft'; end if;
    return new;
  end if;

  if new.legacy_id is distinct from old.legacy_id and old.legacy_id is not null then
    raise exception 'legacy_id never changes' using errcode = 'check_violation';
  end if;
  if new.kind <> old.kind then
    raise exception 'an item cannot change kind' using errcode = 'check_violation';
  end if;

  text_changed := (new.en, new.pa, new.rom, new.pa_alts, new.rom_alts, new.note, new.gender_forms)
    is distinct from (old.en, old.pa, old.rom, old.pa_alts, old.rom_alts, old.note, old.gender_forms);
  new.version := old.version + (case when text_changed then 1 else 0 end);
  new.pa_version := old.pa_version + (case when new.pa is distinct from old.pa then 1 else 0 end);
  new.updated_at := now();

  if by_user and new.status <> old.status and not app.is_admin() then
    -- editors may only ask for review or pull an item back to draft; everything else happens through review / recording
    if not ((old.status in ('draft', 'changes_requested') and new.status = 'in_review')
         or (old.status = 'in_review' and new.status = 'draft')) then
      raise exception 'status % → % is not allowed', old.status, new.status using errcode = 'check_violation';
    end if;
  end if;

  -- edited after approval → back to review (unless an admin is deliberately setting the status in the same update)
  if text_changed and old.status in ('approved_text', 'recording', 'approved_audio', 'ready', 'published') and new.status = old.status then
    new.status := 'in_review';
  end if;
  return new;
end $$;
create trigger items_before_write before insert or update on public.items for each row execute function app.items_before_write();

create function app.no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'items are never deleted — set status = retired' using errcode = 'check_violation'; end $$;
create trigger items_no_delete before delete on public.items for each row execute function app.no_delete();

-- ---------------------------------------------------------------- text review
create function app.needs_audio(k public.item_kind) returns boolean language sql immutable as $$
  select k in ('letter', 'vocab', 'phrase')
$$;

create function app.review_before_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare it public.items;
begin
  select * into it from public.items where id = new.item_id for update;
  if it.status not in ('in_review', 'changes_requested') then
    raise exception 'item is not in review (status %)', it.status using errcode = 'check_violation';
  end if;
  if new.item_version is null or new.item_version <> it.version then
    raise exception 'review is for version % but the item is at version %', new.item_version, it.version using errcode = 'check_violation';
  end if;
  new.at := now();
  return new;
end $$;
create trigger review_before_insert before insert on public.item_field_reviews for each row execute function app.review_before_insert();

create function app.review_after_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  it public.items;
  all_ok boolean;
  religious_ok boolean := true;
begin
  select * into it from public.items where id = new.item_id;
  if new.verdict = 'change' then
    update public.items set status = 'changes_requested' where id = it.id and status <> 'changes_requested';
    return null;
  end if;
  -- every field's latest verdict at this version must be ok
  select not exists (
    select 1 from unnest(enum_range(null::public.review_field)) f
    where (select r.verdict from public.item_field_reviews r
           where r.item_id = it.id and r.item_version = it.version and r.field = f
           order by r.at desc, r.id desc limit 1) is distinct from 'ok'
  ) into all_ok;
  if it.tags && array['gurbani', 'gurdwara'] then
    select exists (
      select 1 from public.item_field_reviews r join public.studio_users u on u.id = r.reviewer_id
      where r.item_id = it.id and r.item_version = it.version and r.verdict = 'ok' and 'religious_reviewer' = any (u.roles)
    ) into religious_ok;
  end if;
  if all_ok and religious_ok then
    update public.items set status = (case when app.needs_audio(it.kind) then 'approved_text' else 'ready' end)::public.item_status where id = it.id;
  elsif it.status = 'changes_requested' then
    null; -- stays until the editor sends it back for review
  end if;
  return null;
end $$;
create trigger review_after_insert after insert on public.item_field_reviews for each row execute function app.review_after_insert();

-- ---------------------------------------------------------------- recordings
create function app.recording_before_insert() returns trigger language plpgsql security definer set search_path = '' as $$
declare it public.items;
begin
  select * into it from public.items where id = new.item_id for update;
  if it.status not in ('approved_text', 'recording', 'approved_audio', 'ready', 'published') then
    raise exception 'text must be approved before recording (status %)', it.status using errcode = 'check_violation';
  end if;
  new.pa_version := it.pa_version;
  new.take_no := coalesce((select max(r.take_no) from public.recordings r
                           where r.item_id = new.item_id and r.speaker_id = new.speaker_id and r.is_slow = new.is_slow), 0) + 1;
  new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.is_best := false;
  return new;
end $$;
create trigger recording_before_insert before insert on public.recordings for each row execute function app.recording_before_insert();

create function app.recording_before_update() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if (new.item_id, new.speaker_id, new.take_no, new.pa_version, new.is_slow) is distinct from (old.item_id, old.speaker_id, old.take_no, old.pa_version, old.is_slow) then
    raise exception 'a take cannot be moved' using errcode = 'check_violation';
  end if;
  if new.status <> old.status then
    if uid is not null then
      if uid = old.speaker_id then
        raise exception 'a take is approved by a second native speaker, not the speaker' using errcode = 'check_violation';
      end if;
      if not app.has_role('owner', 'admin', 'reviewer', 'religious_reviewer') then
        raise exception 'only reviewers approve takes' using errcode = 'insufficient_privilege';
      end if;
      new.reviewed_by := uid;
    end if;
    new.reviewed_at := now();
  end if;
  if new.is_best and new.status <> 'approved' then
    raise exception 'only an approved take can be the best take' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger recording_before_update before update on public.recordings for each row execute function app.recording_before_update();

-- item status follows its recordings: approved_text → recording → approved_audio → ready
create function app.recording_after_write() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  it public.items;
  has_normal boolean;
  has_slow boolean;
  target public.item_status;
begin
  select * into it from public.items where id = new.item_id;
  if it.status not in ('approved_text', 'recording', 'approved_audio', 'ready') then return null; end if;
  select coalesce(bool_or(not r.is_slow), false), coalesce(bool_or(r.is_slow), false) into has_normal, has_slow
    from public.recordings r where r.item_id = it.id and r.status = 'approved' and r.pa_version = it.pa_version;
  target := case
    when not has_normal then 'recording'
    when it.kind = 'phrase' and not has_slow then 'approved_audio'   -- phrases also need a slow take
    else 'ready' end;
  if target <> it.status then update public.items set status = target where id = it.id; end if;
  return null;
end $$;
create trigger recording_after_write after insert or update on public.recordings for each row execute function app.recording_after_write();

-- ---------------------------------------------------------------- releases
/** Publish everything that is ready (plus what is already published) as a new versioned release. Owner/Admin only. */
create function public.publish_release(p_version text, p_notes text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if (select auth.uid()) is not null and not app.is_admin() then
    raise exception 'only an owner or admin can publish' using errcode = 'insufficient_privilege';
  end if;
  insert into public.releases (version, notes, published_by) values (p_version, p_notes, (select auth.uid())) returning id into rid;
  insert into public.release_items (release_id, item_id, item_version, recording_id, slow_recording_id)
  select rid, i.id, i.version,
    (select r.id from public.recordings r where r.item_id = i.id and r.status = 'approved' and r.pa_version = i.pa_version and not r.is_slow
      order by r.is_best desc, r.reviewed_at desc limit 1),
    (select r.id from public.recordings r where r.item_id = i.id and r.status = 'approved' and r.pa_version = i.pa_version and r.is_slow
      order by r.is_best desc, r.reviewed_at desc limit 1)
  from public.items i where i.status in ('ready', 'published');
  if not found then raise exception 'nothing is ready to publish' using errcode = 'check_violation'; end if;
  update public.items set status = 'published' where status = 'ready';
  return rid;
end $$;

-- ---------------------------------------------------------------- audit
create function app.audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb;
begin
  if current_setting('app.skip_audit', true) = 'on' and (select auth.uid()) is null then return null; end if;  -- bulk seed import
  if tg_op <> 'INSERT' then b := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then a := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and a = b then return null; end if;
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values ((select auth.uid()), lower(tg_op), tg_table_name, coalesce(a ->> 'id', b ->> 'id'), b, a);
  return null;
end $$;
create trigger audit after insert or update or delete on public.items for each row execute function app.audit();
create trigger audit after insert or update or delete on public.item_field_reviews for each row execute function app.audit();
create trigger audit after insert or update or delete on public.recordings for each row execute function app.audit();
create trigger audit after insert or update or delete on public.comments for each row execute function app.audit();
create trigger audit after insert or update or delete on public.releases for each row execute function app.audit();
create trigger audit after insert or update or delete on public.studio_users for each row execute function app.audit();
create trigger audit after insert or update or delete on public.units for each row execute function app.audit();
create trigger audit after insert or update or delete on public.lessons for each row execute function app.audit();

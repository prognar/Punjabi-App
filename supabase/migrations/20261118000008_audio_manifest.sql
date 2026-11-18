-- Audio for the learner apps (until content packs ship): per card, the computer-voice tuning and the approved takes.
-- Only audio fields are exposed; Studio text and unapproved takes stay private.

create function public.audio_manifest() returns table (
  item_id uuid, speak_as text, voice text, rate numeric, rec text, rec_slow text, updated_at timestamptz
) language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (r.item_id, r.is_slow) r.item_id, r.is_slow, r.storage_path, r.reviewed_at
    from public.recordings r join public.items i on i.id = r.item_id
    where r.status = 'approved' and r.pa_version = i.pa_version
    order by r.item_id, r.is_slow, r.is_best desc, r.reviewed_at desc nulls last
  )
  select i.id, i.data ->> 'speakAs', i.data ->> 'voice', (i.data ->> 'rate')::numeric,
    n.storage_path, s.storage_path, greatest(i.updated_at, n.reviewed_at, s.reviewed_at)
  from public.items i
  left join best n on n.item_id = i.id and not n.is_slow
  left join best s on s.item_id = i.id and s.is_slow
  where (select auth.uid()) is not null
    and i.kind in ('letter', 'vocab', 'phrase') and i.status <> 'retired'
    and (i.data ? 'speakAs' or i.data ? 'voice' or i.data ? 'rate' or n.storage_path is not null or s.storage_path is not null)
$$;
revoke execute on function public.audio_manifest() from public, anon;
grant execute on function public.audio_manifest() to authenticated;

-- signed-in learners may fetch approved takes (needed to create signed URLs); pending and rejected takes stay Studio-only
create function app.is_approved_take(p text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recordings r where r.storage_path = p and r.status = 'approved')
$$;
grant execute on function app.is_approved_take(text) to authenticated;
create policy recordings_read_approved on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and app.is_approved_take(name));

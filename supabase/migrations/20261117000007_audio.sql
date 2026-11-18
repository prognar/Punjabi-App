-- Audio in the Studio: recordings storage, and per-card computer-voice tuning ("say it as") that a native speaker confirms.

-- ---------------------------------------------------------------- recordings bucket (private; the Studio plays takes through signed URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 5242880, array['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac'])
on conflict (id) do nothing;

-- objects are stored as <speaker uid>/<item id>/<file>
create policy recordings_read on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and app.is_studio());
create policy recordings_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and app.has_role('owner', 'admin', 'voice_talent')
              and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- computer-voice tuning
-- items.data keys (same names the prototype used): speakAs (text the voice reads instead, Gurmukhi or English letters),
-- voice ('pa' | 'hi' | 'en'; absent = automatic), rate (0.4–1.5; absent = 0.8), plus tts_ok_by / tts_ok_at when a native
-- speaker has listened and confirmed it sounds right. Changing the tuning clears an earlier confirmation.
create function public.set_pronunciation(p_item uuid, p_speak_as text, p_voice text, p_rate numeric, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  d jsonb;
  tuned jsonb;
begin
  if not app.has_role('owner', 'admin', 'editor', 'reviewer', 'religious_reviewer', 'voice_talent') then
    raise exception 'only Studio editors, reviewers and voice talent can tune the voice' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_voice, 'auto') not in ('auto', 'pa', 'hi', 'en') then
    raise exception 'voice must be auto, pa, hi or en' using errcode = 'check_violation';
  end if;
  if p_rate is not null and (p_rate < 0.4 or p_rate > 1.5) then
    raise exception 'speed must be between 0.4 and 1.5' using errcode = 'check_violation';
  end if;
  select data into d from public.items where id = p_item for update;
  if not found then raise exception 'no such card' using errcode = 'no_data_found'; end if;

  tuned := jsonb_strip_nulls(jsonb_build_object(
    'speakAs', nullif(btrim(coalesce(p_speak_as, '')), ''),
    'voice', nullif(coalesce(p_voice, 'auto'), 'auto'),
    'rate', case when p_rate is null or abs(p_rate - 0.8) < 0.001 then null else round(p_rate, 2) end));

  -- clear the confirmation if what the voice says changed
  if (d -> 'speakAs', d -> 'voice', d -> 'rate') is distinct from (tuned -> 'speakAs', tuned -> 'voice', tuned -> 'rate') then
    d := d - 'tts_ok_by' - 'tts_ok_at';
  end if;
  d := (d - 'speakAs' - 'voice' - 'rate') || tuned;
  if p_confirm then d := d || jsonb_build_object('tts_ok_by', uid, 'tts_ok_at', now()); end if;

  update public.items set data = d where id = p_item;
  return d;
end $$;
revoke execute on function public.set_pronunciation(uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.set_pronunciation(uuid, text, text, numeric, boolean) to authenticated;

-- Supabase security advisor: pin the search_path on app.needs_audio.
alter function app.needs_audio(public.item_kind) set search_path = '';

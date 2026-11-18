-- Database tests: seed counts, item lifecycle, row-level security. Runs inside one transaction and rolls back.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'ok   %', msg; end $$;
-- runs a statement and reports whether it was rejected
create function pg_temp.rejected(stmt text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return true; end $$;
create function pg_temp.login(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  if u is null then reset role; else set local role authenticated; end if; end $$;
create function pg_temp.st(l text) returns text language sql as $$ select status::text from public.items where legacy_id = l $$;
grant all on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------- seed
select pg_temp.ok((select count(*) from items where kind = 'letter') = 35, '35 letters');
select pg_temp.ok((select count(*) from items where kind = 'vocab') = 760, '760 words');
select pg_temp.ok((select count(*) from items where kind = 'phrase') = 288, '288 phrases');
select pg_temp.ok((select count(*) from lessons) = 38, '38 lessons');
select pg_temp.ok((select count(*) from items where kind = 'sentence') = 1250, '1250 sentences');
select pg_temp.ok((select count(*) from items where kind = 'conversation') = 25, '25 conversations');
select pg_temp.ok((select count(*) from items where status <> 'draft') = 0, 'everything starts as draft (0 native-verified)');
select pg_temp.ok((select count(*) from lesson_items li join lessons l on l.id = li.lesson_id where l.legacy_n = 1) = 30, 'lesson 1 = 2 letters + 20 words + 8 phrases');
select pg_temp.ok((select count(*) from items i where i.kind in ('sentence', 'conversation') and not exists (select 1 from item_focus f where f.item_id = i.id)) = 0, 'every sentence / conversation has a focus card');
select pg_temp.ok((select count(*) from audit_log) = 0, 'seed import is not audited');
select pg_temp.ok((select count(*) from items where 'gurdwara' = any (tags) and kind in ('vocab', 'phrase')) between 60 and 130, 'gurdwara cards are tagged for religious review');

-- ---------------------------------------------------------------- people
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner'), ('00000000-0000-0000-0000-00000000000b', 'editor'),
  ('00000000-0000-0000-0000-00000000000c', 'reviewer'), ('00000000-0000-0000-0000-00000000000d', 'granthi'),
  ('00000000-0000-0000-0000-00000000000e', 'voice'), ('00000000-0000-0000-0000-00000000000f', 'parent'),
  ('00000000-0000-0000-0000-000000000010', 'parent2');
insert into studio_users (id, roles, display_name) values
  ('00000000-0000-0000-0000-00000000000a', '{owner}', 'Owner'), ('00000000-0000-0000-0000-00000000000b', '{editor}', 'Editor'),
  ('00000000-0000-0000-0000-00000000000c', '{reviewer}', 'Reviewer'), ('00000000-0000-0000-0000-00000000000d', '{reviewer,religious_reviewer}', 'Granthi'),
  ('00000000-0000-0000-0000-00000000000e', '{voice_talent}', 'Voice');
\set owner '''00000000-0000-0000-0000-00000000000a'''
\set editor '''00000000-0000-0000-0000-00000000000b'''
\set reviewer '''00000000-0000-0000-0000-00000000000c'''
\set granthi '''00000000-0000-0000-0000-00000000000d'''
\set voice '''00000000-0000-0000-0000-00000000000e'''
\set parent '''00000000-0000-0000-0000-00000000000f'''
\set parent2 '''00000000-0000-0000-0000-000000000010'''

create function pg_temp.review_all(l text, who uuid) returns void language sql as $$
  insert into public.item_field_reviews (item_id, field, reviewer_id, verdict, item_version)
  select i.id, f, who, 'ok', i.version from public.items i, unnest(enum_range(null::public.review_field)) f where i.legacy_id = l
$$;

-- ---------------------------------------------------------------- lifecycle: a word (v-cat)
select pg_temp.login(:editor);
select pg_temp.ok(pg_temp.rejected($$update items set status = 'published' where legacy_id = 'v-cat'$$), 'editor cannot publish directly');
select pg_temp.ok(pg_temp.rejected($$update items set legacy_id = 'v-kitty' where legacy_id = 'v-cat'$$), 'legacy_id never changes');
select pg_temp.ok(pg_temp.rejected($$delete from items where legacy_id = 'v-cat'$$) or pg_temp.st('v-cat') is not null, 'items cannot be deleted');
update items set status = 'in_review' where legacy_id = 'v-cat';
select pg_temp.ok(pg_temp.st('v-cat') = 'in_review', 'editor requests review');
select pg_temp.ok(pg_temp.rejected($$insert into item_field_reviews (item_id, field, reviewer_id, verdict, item_version) select id, 'pa', '00000000-0000-0000-0000-00000000000b', 'ok', version from items where legacy_id = 'v-cat'$$), 'editor cannot review');

select pg_temp.login(:voice);
select pg_temp.ok(pg_temp.rejected($$insert into recordings (item_id, speaker_id, storage_path) select id, '00000000-0000-0000-0000-00000000000e', 'x.m4a' from items where legacy_id = 'v-cat'$$), 'no recording before the text is approved');

select pg_temp.login(:reviewer);
insert into item_field_reviews (item_id, field, reviewer_id, verdict, comment, item_version) select id, 'rom', :reviewer, 'change', 'bil-lee', version from items where legacy_id = 'v-cat';
select pg_temp.ok(pg_temp.st('v-cat') = 'changes_requested', 'a "change" verdict requests changes');
select pg_temp.ok(pg_temp.rejected($$update items set rom = 'x' where legacy_id = 'v-cat'$$) or (select rom from items where legacy_id = 'v-cat') <> 'x', 'reviewer cannot edit cards');

select pg_temp.login(:editor);
update items set rom = 'bil-lee', status = 'in_review' where legacy_id = 'v-cat';
select pg_temp.ok((select version from items where legacy_id = 'v-cat') = 2, 'editing a language field bumps the version');

select pg_temp.login(:reviewer);
select pg_temp.ok(pg_temp.rejected($$insert into item_field_reviews (item_id, field, reviewer_id, verdict, item_version) select id, 'pa', '00000000-0000-0000-0000-00000000000c', 'ok', 1 from items where legacy_id = 'v-cat'$$), 'a review of an old version is rejected');
insert into item_field_reviews (item_id, field, reviewer_id, verdict, item_version) select id, 'pa', :reviewer, 'ok', version from items where legacy_id = 'v-cat';
select pg_temp.ok(pg_temp.st('v-cat') = 'in_review', 'one field ✓ is not enough');
select pg_temp.review_all('v-cat', :reviewer);
select pg_temp.ok(pg_temp.st('v-cat') = 'approved_text', 'all six fields ✓ → approved_text');

select pg_temp.login(:voice);
insert into recordings (item_id, speaker_id, storage_path) select id, :voice, 'audio/v-cat/1.m4a' from items where legacy_id = 'v-cat';
insert into recordings (item_id, speaker_id, storage_path) select id, :voice, 'audio/v-cat/2.m4a' from items where legacy_id = 'v-cat';
select pg_temp.ok(pg_temp.st('v-cat') = 'recording', 'first take → recording');
select pg_temp.ok((select array_agg(take_no order by take_no) from recordings r join items i on i.id = r.item_id where i.legacy_id = 'v-cat') = '{1,2}', 'takes are numbered');
select pg_temp.ok(pg_temp.rejected($$update recordings set status = 'approved' where storage_path = 'audio/v-cat/2.m4a'$$) or (select status from recordings where storage_path = 'audio/v-cat/2.m4a') = 'pending', 'voice talent cannot approve their own take');

select pg_temp.login(:reviewer);
update recordings set status = 'approved', is_best = true where storage_path = 'audio/v-cat/2.m4a';
select pg_temp.ok(pg_temp.st('v-cat') = 'ready', 'approved take → ready (a word needs no slow take)');
select pg_temp.ok((select reviewed_by from recordings where storage_path = 'audio/v-cat/2.m4a') = :reviewer, 'audio reviewer is recorded');

-- ---------------------------------------------------------------- lifecycle: a phrase needs a slow take
select pg_temp.login(:editor);  update items set status = 'in_review' where legacy_id = 'p-thank-you';
select pg_temp.login(:reviewer); select pg_temp.review_all('p-thank-you', :reviewer);
select pg_temp.login(:voice);
insert into recordings (item_id, speaker_id, storage_path) select id, :voice, 'audio/p-thank-you/1.m4a' from items where legacy_id = 'p-thank-you';
select pg_temp.login(:reviewer); update recordings set status = 'approved' where storage_path = 'audio/p-thank-you/1.m4a';
select pg_temp.ok(pg_temp.st('p-thank-you') = 'approved_audio', 'phrase with only a normal take → approved_audio');
select pg_temp.login(:voice);
insert into recordings (item_id, speaker_id, storage_path, is_slow) select id, :voice, 'audio/p-thank-you/slow1.m4a', true from items where legacy_id = 'p-thank-you';
select pg_temp.login(:reviewer); update recordings set status = 'approved' where storage_path = 'audio/p-thank-you/slow1.m4a';
select pg_temp.ok(pg_temp.st('p-thank-you') = 'ready', 'phrase with normal + slow takes → ready');

-- ---------------------------------------------------------------- religious sign-off
select pg_temp.login(null);
select set_config('t.gur', (select legacy_id from items where 'gurdwara' = any (tags) and kind = 'vocab' order by legacy_id limit 1), true);
select pg_temp.login(:editor);  update items set status = 'in_review' where legacy_id = current_setting('t.gur');
select pg_temp.login(:reviewer); select pg_temp.review_all(current_setting('t.gur'), :reviewer);
select pg_temp.ok(pg_temp.st(current_setting('t.gur')) = 'in_review', 'gurdwara card: all ✓ from a regular reviewer is not enough');
select pg_temp.login(:granthi);
insert into item_field_reviews (item_id, field, reviewer_id, verdict, item_version) select id, 'cultural_fit', :granthi, 'ok', version from items where legacy_id = current_setting('t.gur');
select pg_temp.ok(pg_temp.st(current_setting('t.gur')) = 'approved_text', 'gurdwara card: religious reviewer ✓ → approved_text');

-- ---------------------------------------------------------------- sentences need no audio
select pg_temp.login(:editor);  update items set status = 'in_review' where legacy_id = 's0';
select pg_temp.login(:reviewer); select pg_temp.review_all('s0', :reviewer);
select pg_temp.ok(pg_temp.st('s0') = 'ready', 'sentence: text approved → ready (no recording step)');

-- ---------------------------------------------------------------- release
select pg_temp.login(:editor);
select pg_temp.ok(pg_temp.rejected($$select publish_release('0.0.1')$$), 'editor cannot publish a release');
select pg_temp.login(:owner);
select publish_release('0.1.0', 'first test release');
select pg_temp.ok((select count(*) from release_items) = 3, 'release contains the 3 ready items');
select pg_temp.ok((select recording_id is not null and slow_recording_id is not null from release_items ri join items i on i.id = ri.item_id where i.legacy_id = 'p-thank-you'), 'release pins the approved normal + slow takes');
select pg_temp.ok(pg_temp.st('v-cat') = 'published', 'released items are published');
select pg_temp.ok(pg_temp.rejected($$select publish_release('0.1.0')$$), 'release versions are unique');

-- ---------------------------------------------------------------- edit after approval → back to review
select pg_temp.login(:editor);
update items set note = 'pet cat' where legacy_id = 'v-cat';
select pg_temp.ok(pg_temp.st('v-cat') = 'in_review', 'editing a published card sends it back to review');
update items set category = 'nature' where legacy_id = 'p-thank-you';
select pg_temp.ok(pg_temp.st('p-thank-you') = 'published', 'changing a non-language field does not');
select pg_temp.login(:owner);
select pg_temp.ok((select count(*) from audit_log where entity = 'items' and entity_id = (select id::text from items where legacy_id = 'v-cat')) >= 6, 'item history is in the audit log');
select pg_temp.login(:editor);
select pg_temp.ok((select count(*) from audit_log) = 0, 'only owner/admin read the audit log');

-- ---------------------------------------------------------------- learners
select pg_temp.login(:parent);
select pg_temp.ok((select count(*) from items) = 0, 'a learner account cannot read studio content');
select pg_temp.ok(pg_temp.rejected($$insert into accounts (id, plan) values ('00000000-0000-0000-0000-00000000000f', 'family')$$), 'an account cannot give itself a paid plan');
insert into accounts (id) values (:parent);
insert into learners (id, account_id, name, type) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, :parent, 'Kid ' || g, 'kid' from generate_series(1, 6) g;
select pg_temp.ok(pg_temp.rejected($$insert into learners (account_id, name) values ('00000000-0000-0000-0000-00000000000f', 'Seventh')$$), 'at most 6 learner profiles');
select pg_temp.login(null);
select set_config('t.cat', (select id::text from items where legacy_id = 'v-cat'), true);
select pg_temp.login(:parent);
insert into item_progress (learner_id, item_id, box, intro) values ('00000000-0000-0000-0000-000000000101', current_setting('t.cat')::uuid, 1, true);
insert into events (learner_id, type, item_id, exercise, correct, ms) values ('00000000-0000-0000-0000-000000000101', 'answer', current_setting('t.cat')::uuid, 'mc-en2pa', true, 2100);
select pg_temp.ok((select count(*) from item_progress) = 1, 'parent sees own family progress');

select pg_temp.login(:parent2);
insert into accounts (id) values (:parent2);
select pg_temp.ok((select count(*) from learners) = 0 and (select count(*) from item_progress) = 0 and (select count(*) from events) = 0, 'another account sees none of it');
select pg_temp.ok(pg_temp.rejected($$insert into item_progress (learner_id, item_id) values ('00000000-0000-0000-0000-000000000102', current_setting('t.cat')::uuid)$$), 'another account cannot write into it');
select pg_temp.ok(pg_temp.rejected($$insert into events (learner_id, type) values ('00000000-0000-0000-0000-000000000101', 'answer')$$), 'another account cannot log events for it');

-- ---------------------------------------------------------------- computer-voice tuning
select pg_temp.login(:reviewer);
select set_pronunciation((select id from items where legacy_id = 'v-ball'), 'gaynd', 'en', 0.7, false);
select pg_temp.ok((select data ->> 'speakAs' = 'gaynd' and data ->> 'voice' = 'en' and (data ->> 'rate')::numeric = 0.7 and not data ? 'tts_ok_by' from items where legacy_id = 'v-ball'), 'reviewer saves a say-it-as spelling');
select set_pronunciation((select id from items where legacy_id = 'v-ball'), 'gaynd', 'en', 0.7, true);
select pg_temp.ok((select data ->> 'tts_ok_by' = '00000000-0000-0000-0000-00000000000c' from items where legacy_id = 'v-ball'), 'reviewer confirms it sounds right');
select pg_temp.ok((select status from items where legacy_id = 'v-ball') = 'draft' and (select version from items where legacy_id = 'v-ball') = 1, 'tuning the voice does not change status or version');
select set_pronunciation((select id from items where legacy_id = 'v-ball'), 'ਗੇਂਦ', 'auto', 0.8, false);
select pg_temp.ok((select not data ? 'tts_ok_by' and not data ? 'voice' and not data ? 'rate' from items where legacy_id = 'v-ball'), 'changing it clears the confirmation; defaults are not stored');
select pg_temp.ok(pg_temp.rejected($$select set_pronunciation((select id from items where legacy_id = 'v-ball'), 'x', 'fr', 1, false)$$), 'unknown voice is rejected');
select pg_temp.ok(pg_temp.rejected($$select set_pronunciation((select id from items where legacy_id = 'v-ball'), 'x', 'en', 3, false)$$), 'silly speed is rejected');
select pg_temp.login(:parent);
select pg_temp.ok(pg_temp.rejected($$select set_pronunciation('00000000-0000-0000-0000-000000000000', 'x', 'en', 1, false)$$), 'a learner account cannot tune the voice');

-- ---------------------------------------------------------------- recordings storage
select pg_temp.login(:voice);
insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-0000-0000-00000000000e/item/take.wav');
select pg_temp.ok(pg_temp.rejected($$insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-0000-0000-00000000000c/item/take.wav')$$), 'voice talent uploads only into their own folder');
select pg_temp.login(:reviewer);
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'recordings') = 1, 'studio users can listen to takes');
select pg_temp.ok(pg_temp.rejected($$insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-0000-0000-00000000000c/item/take.wav')$$), 'reviewers without the voice role cannot upload');
select pg_temp.login(:parent);
select pg_temp.ok((select count(*) from storage.objects) = 0, 'learner accounts cannot read takes');

-- ---------------------------------------------------------------- audio manifest for learner apps
select pg_temp.login(null);
insert into storage.objects (bucket_id, name) values ('recordings', 'audio/v-cat/1.m4a'), ('recordings', 'audio/v-cat/2.m4a');
select pg_temp.login(:parent);
select pg_temp.login(null);
select set_config('t.cat', (select id::text from items where legacy_id = 'v-cat'), true);
select pg_temp.login(:parent);
select pg_temp.ok((select rec from audio_manifest() where item_id = current_setting('t.cat')::uuid) = 'audio/v-cat/2.m4a', 'manifest lists the approved take for a learner');
select pg_temp.ok((select speak_as from audio_manifest() where item_id = (select item_id from audio_manifest() where speak_as = 'ਗੇਂਦ')) = 'ਗੇਂਦ', 'manifest lists say-it-as tuning');
select pg_temp.ok((select count(*) from audio_manifest() where rec = 'audio/v-cat/1.m4a') = 0, 'manifest never lists unapproved takes');
select pg_temp.ok((select count(*) from storage.objects where name = 'audio/v-cat/2.m4a') = 1, 'a learner can fetch an approved take');
select pg_temp.ok((select count(*) from storage.objects where name = 'audio/v-cat/1.m4a') = 0, 'a learner cannot fetch a pending take');
select pg_temp.login(null);
select pg_temp.ok((select count(*) from audio_manifest()) = 0, 'signed-out callers get nothing');

select pg_temp.login(null);
rollback;
\echo ALL DATABASE TESTS PASSED

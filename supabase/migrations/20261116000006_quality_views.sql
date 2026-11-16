-- Quality dashboard: counts by status, and progress per lesson. security_invoker → row-level security of the caller applies.
create view public.item_status_counts with (security_invoker = true) as
  select kind, status, count(*)::int as n from public.items group by kind, status;

create view public.lesson_quality with (security_invoker = true) as
  select l.id as lesson_id, l.legacy_n, l.title, l.sort_order,
    count(*)::int as total,
    (count(*) filter (where i.status in ('approved_text', 'recording', 'approved_audio', 'ready', 'published')))::int as text_approved,
    (count(*) filter (where i.status in ('ready', 'published')))::int as ready,
    (count(*) filter (where i.status = 'in_review'))::int as in_review,
    (count(*) filter (where i.status = 'changes_requested'))::int as changes_requested
  from public.lessons l
  join public.lesson_items li on li.lesson_id = l.id
  join public.items i on i.id = li.item_id
  where i.status <> 'retired'
  group by l.id;

revoke all on public.item_status_counts, public.lesson_quality from anon;
grant select on public.item_status_counts, public.lesson_quality to authenticated;

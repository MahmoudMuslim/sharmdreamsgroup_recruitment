-- ============================================================================
-- RLS for the currencies reference table.
--
-- `rls_auto_enable()` enables RLS on every newly created table, which is the
-- right default — it fails closed. But it creates no policies, so the table
-- became invisible to everyone including staff: Settings showed 0 currencies
-- and the job form had nothing to select from.
--
-- This adds the same read/write pair the other master-data tables carry.
-- ============================================================================

-- Staff need to read the list to maintain it; the jobs page renders the code
-- rather than the row, so nothing public needs this table.
drop policy if exists currencies_read on currencies;
create policy currencies_read on currencies
  for select using (is_active OR is_staff());

drop policy if exists currencies_write on currencies;
create policy currencies_write on currencies
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

comment on table currencies is
  'ISO 4217 currencies job salaries can be denominated in. RLS is enabled with '
  'explicit policies because rls_auto_enable() only turns RLS on, it does not '
  'grant access.';

-- ---------------------------------------------------------------------------
-- Repair any suites left with non-contiguous positions by 1-based seed data.
--
-- The question editor renumbers on every save, so untouched suites keep their
-- original 1-based positions. Ordering is by `position`, so this changes no
-- candidate's question order — it only makes the sequence dense, which is what
-- insert/move/edit all assume.
-- ---------------------------------------------------------------------------
do $$
declare
  suite record;
  question record;
  idx integer;
begin
  -- Any suite whose positions are not exactly 0..n-1 in order. The window
  -- function is computed in a subquery because Postgres forbids window
  -- functions in both WHERE and HAVING.
  for suite in
    select template_id
    from (
      select template_id,
             position,
             dense_rank() over (partition by template_id order by position) - 1 as expected
      from assessment_questions
    ) ranked
    where position <> expected
    group by template_id
  loop
    idx := 0;
    for question in
      select q.id from assessment_questions q
      where q.template_id = suite.template_id
      order by q.position
    loop
      update assessment_questions
      set position = idx
      where id = question.id
        and position <> idx;
      idx := idx + 1;
    end loop;
  end loop;
end $$;
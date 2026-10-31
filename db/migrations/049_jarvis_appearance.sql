begin;

alter table public.assistant_jarvis_prefs
  add column if not exists appearance jsonb
  constraint assistant_jarvis_appearance_size check (
    appearance is null or (
      jsonb_typeof(appearance) = 'object'
      and octet_length(appearance::text) <= 32768
    )
  );

notify pgrst, 'reload schema';
commit;

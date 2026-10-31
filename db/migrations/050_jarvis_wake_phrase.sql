begin;

alter table public.assistant_jarvis_prefs
  add column if not exists wake_phrase text
  constraint assistant_jarvis_wake_phrase_shape check (
    wake_phrase is null
    or (
      char_length(btrim(wake_phrase)) between 1 and 48
      and wake_phrase !~ '[\u0000-\u001F]'
    )
  );

notify pgrst, 'reload schema';
commit;

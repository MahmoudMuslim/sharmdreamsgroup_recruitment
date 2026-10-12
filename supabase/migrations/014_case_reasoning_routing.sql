-- deepseek/deepseek-r1:free was retired from OpenRouter's free tier (the API
-- answers 404 "unavailable for free"), so every case_reasoning call wasted its
-- first hop and the bogus "openrouter/free" chain entry failed the next one.
-- Route the capability to the working pair; guarded so user-customized
-- routing is left alone.
update ai_model_config
set primary_model = 'google/gemma-4-31b-it:free',
    fallback_model = 'google/gemma-4-26b-a4b-it:free'
where capability = 'case_reasoning'
  and primary_model = 'deepseek/deepseek-r1:free';

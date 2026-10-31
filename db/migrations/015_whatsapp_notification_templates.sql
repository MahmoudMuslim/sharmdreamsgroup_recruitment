-- 015 — candidate WhatsApp copy is edited, not hardcoded.
--
-- `key` carried a plain UNIQUE constraint, so one event could only hold one
-- channel's body. The WHATSAPP rows therefore had nowhere to put stage-change
-- or interview copy and the dispatch path fell back to strings in code.
-- Uniqueness becomes (key, channel): the same event can now carry an email and
-- a WhatsApp body, which is what the channel column always implied.
--
-- Seed bodies mirror the strings that were in whatsapp-dispatch.ts, so wiring
-- the table changes nothing until a recruiter edits a row.

alter table notification_templates
  drop constraint if exists notification_templates_key_key;

drop index if exists notification_templates_key_channel_key;

alter table notification_templates
  add constraint notification_templates_key_channel_key unique (key, channel);

insert into notification_templates (key, channel, subject, body) values
  ('stage_new', 'WHATSAPP', null,
   'Hi {{candidate_name}}, your application for {{job_title}} is active in our pipeline again. We will keep you updated here.'),

  ('stage_ai_screening', 'WHATSAPP', null,
   'Hi {{candidate_name}}, your application for {{job_title}} is now being reviewed by our screening team.'),

  ('stage_assessment', 'WHATSAPP', null,
   'Hi {{candidate_name}}, good news — you have moved to the assessment stage for {{job_title}}. {{assessment_link}}'),

  ('stage_interview', 'WHATSAPP', null,
   'Hi {{candidate_name}}, you have reached the interview stage for {{job_title}}. We will be in touch shortly to arrange a time.'),

  ('stage_offer', 'WHATSAPP', null,
   'Hi {{candidate_name}}, we are excited to move forward with an offer for {{job_title}}. The details are on their way.'),

  ('stage_hired', 'WHATSAPP', null,
   'Welcome aboard, {{candidate_name}}! The {{job_title}} team is looking forward to having you.'),

  ('stage_rejected', 'WHATSAPP', null,
   'Hi {{candidate_name}}, thank you for your interest in {{job_title}}. After careful review we will not be progressing your application this time. We appreciate the time you invested and wish you every success.'),

  ('interview_scheduled', 'WHATSAPP', null,
   'Hi {{candidate_name}}, your interview for {{job_title}} is confirmed for {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}'),

  ('interview_changed', 'WHATSAPP', null,
   'Hi {{candidate_name}}, we have moved your interview for {{job_title}} to {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}'),

  ('interview_cancelled', 'WHATSAPP', null,
   'Hi {{candidate_name}}, we have cancelled your interview for {{job_title}} that was set for {{interview_when}}. We will be in touch to arrange another time.')

-- `do nothing`, not `do update`: re-applying this migration must never roll
-- back copy a recruiter has already changed in Settings.
on conflict (key, channel) do nothing;

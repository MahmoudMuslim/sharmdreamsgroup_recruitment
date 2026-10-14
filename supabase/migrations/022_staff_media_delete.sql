-- ---------------------------------------------------------------------------
-- Staff delete policies for the candidate media buckets.
--
-- `candidate-cvs` has carried a staff DELETE policy since the File Manager
-- shipped, so a recruiter could remove a CV but not the video pitch sitting
-- next to it: a candidate's recording is the more sensitive artefact of the
-- two, and it was the one the portal could only explain away. Deletion is now
-- real everywhere the console offers it.
--
-- Scoped to the buckets holding candidate PII and gated on the same is_staff()
-- predicate the read policies use, so the delete cannot reach a tenant's
-- branding or any bucket added later.
-- ---------------------------------------------------------------------------
drop policy if exists "staff delete candidate media" on storage.objects;

create policy "staff delete candidate media" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('candidate-videos', 'candidate-audio', 'resumes')
    and is_staff()
  );

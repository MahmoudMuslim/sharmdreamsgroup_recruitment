/**
 * `assessment_templates` — one assessment suite: the paper a candidate sits.
 *
 * The console authors these rows and issues attempts against them. `is_active`
 * is what "paused" means: new assignments stop, issued links stay open. The
 * follow-up columns are the second-test rule — `follow_up_template_id` names the
 * suite a weak score routes to, and the percent band says what "weak" is — and
 * the CHECKs on this table require all three or none, and refuse a suite that
 * points at itself.
 *
 * The eight-column projection the console used to read has been retired; this
 * is the row itself, in the order the database holds it.
 */

export interface AssessmentTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: number;
  is_active: boolean;
  created_at: string;
  randomize_questions: boolean;
  randomize_options: boolean;
  block_copy_paste: boolean;
  follow_up_template_id: string | null;
  follow_up_min_percent: number | null;
  follow_up_max_percent: number | null;
}

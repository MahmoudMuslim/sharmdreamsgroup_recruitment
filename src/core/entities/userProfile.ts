/**
 * `user_profiles` — one signed-in account.
 *
 * The account, not the person: the recruitment spine lives in
 * `person_profiles`, and an application points at a person. A staff account has
 * a tenant; a super admin's does not.
 */

import type { Locale, UserRole } from "./vocabularies";

export interface UserProfile {
  id: string;
  auth_user_id: string;
  tenant_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  locale: Locale;
  created_at: string;
  /** Ten upper-case hex characters, minted by the column default at insert. */
  referral_code: string;
}

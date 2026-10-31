"use server";

import { getServiceRestClient } from "@/lib/data-api/service";
import { publicBaseUrl } from "@/lib/public-url";

import { recordActivity } from "@/modules/activity/application/record";
import { emailSpellings } from "@/modules/candidates/domain/personIdentity";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import {
  PRIVACY_NOTICE_PATH,
  PRIVACY_WRITE_REFUSAL,
  planPrivacyRequest,
} from "@/modules/privacy/domain/privacy";
import {
  privacyLink,
  mintPrivacyToken,
  verifyPrivacyToken,
} from "@/modules/privacy/application/linkToken";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";

/**
 * The public half of the privacy door.
 *
 * Three doors, and each is deliberately narrow:
 *
 *   - a mailed link names one application and nothing else. Filing from it needs
 *     no typed address, so a link forwarded to the wrong inbox cannot be used to
 *     ask about a different person;
 *   - asking for a link takes an address and always answers the same sentence.
 *     Whether that address is on file is not told to whoever typed it — the
 *     mailbox itself is the only place the answer arrives;
 *   - a filed request is a row in the staff's book and a trail entry that names
 *     the record, never the person.
 *
 * Everything here writes with the service role because a visitor has no session
 * and anon is granted nothing on either table. The checks that matter — is this
 * link ours, is it still valid, is the record still held — happen before any
 * write, and the address a request carries is read from the record rather than
 * from the browser.
 */

export interface PrivacyDoorResult {
  ok: boolean;
  error?: string;
  /** What to tell the visitor; the same words whether a record matched or not. */
  message: string;
}

const LINK_REQUEST_MESSAGE =
  "If that address is on file, a private link is on its way. It opens the page where " +
  "you can ask for a copy of your data or for it to be erased.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** How many applications one link request will write about. */
const LINK_REQUEST_MAX = 3;

function maskedAddress(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "the address on file";
  const first = local.slice(0, 1);
  return `${first}${"•".repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

export type PrivacyTokenDescription =
  | {
      ok: true;
      applicationId: string;
      fullName: string;
      maskedEmail: string;
      jobTitle: string | null;
      validUntil: string;
    }
  | { ok: false; message: string };

/**
 * What a link is allowed to open, or why it opens nothing.
 *
 * The application is read with the service role because the holder has no
 * session; the link is the credential, and its signature was already checked.
 * An erased record answers as a bad link: there is nothing left to ask about.
 */
export async function describePrivacyToken(token: unknown): Promise<PrivacyTokenDescription> {
  const verified = verifyPrivacyToken(token);
  if (!verified.ok) {
    return {
      ok: false,
      message:
        verified.reason === "expired"
          ? "That link has expired. Ask for a new one below."
          : "That link is not one this portal issued, or it has been changed. Ask for a new one below.",
    };
  }

  const service = getServiceRestClient();
  const { data, error } = await service
    .from("applications")
    .select("id, full_name, email, erased_at, job_openings ( title )")
    .eq("id", verified.applicationId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: isMissingSchemaError(error)
        ? PRIVACY_WRITE_REFUSAL
        : "That record could not be opened just now. Try again in a moment.",
    };
  }

  const row = data as Record<string, unknown> | null;
  if (!row || row.erased_at != null) {
    return {
      ok: false,
      message: "That link no longer points at a record we hold. Ask for a new one below.",
    };
  }

  const job = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const email = String(row.email ?? "");

  return {
    ok: true,
    applicationId: String(row.id),
    fullName: String(row.full_name ?? "the person on this application"),
    maskedEmail: maskedAddress(email),
    jobTitle: (job as Record<string, unknown> | null)?.title
      ? String((job as Record<string, unknown>).title)
      : null,
    validUntil: new Date(verified.expiresAt * 1000).toISOString(),
  };
}

/**
 * Files an access or erasure request against the application a link names.
 *
 * The typed address is never used: the record's own address is read server-side
 * and folded by the same planner the desk uses. That is what makes a forwarded
 * link unable to speak for somebody else.
 */
export async function filePrivacyRequest(input: {
  token: unknown;
  kind: unknown;
  note?: unknown;
}): Promise<PrivacyDoorResult> {
  const verified = verifyPrivacyToken(input.token);
  if (!verified.ok) {
    return {
      ok: false,
      message:
        verified.reason === "expired"
          ? "That link has expired. Ask for a new one below."
          : "That link is not one this portal issued. Ask for a new one below.",
    };
  }

  const service = getServiceRestClient();
  const { data, error } = await service
    .from("applications")
    .select("id, email, erased_at, job_openings ( tenant_id )")
    .eq("id", verified.applicationId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: isMissingSchemaError(error)
        ? PRIVACY_WRITE_REFUSAL
        : "The request could not be read just now. Try again in a moment.",
    };
  }

  const row = data as Record<string, unknown> | null;
  if (!row || row.erased_at != null) {
    return {
      ok: false,
      message: "That link no longer points at a record we hold. Ask for a new one below.",
    };
  }

  // The company is the opening's, not the application's: `applications` has no
  // tenant column, and asking it for one refuses the whole read.
  const opening = Array.isArray(row.job_openings) ? row.job_openings[0] : row.job_openings;
  const companyId =
    typeof (opening as Record<string, unknown> | null)?.tenant_id === "string"
      ? ((opening as Record<string, unknown>).tenant_id as string)
      : null;

  const plan = planPrivacyRequest({
    kind: input.kind,
    email: row.email,
    note: input.note,
  });
  if (!plan.ok) return { ok: false, message: plan.error };

  const { error: insertError } = await service.from("privacy_requests").insert({
    kind: plan.kind,
    email: plan.email,
    note: plan.note,
    application_id: verified.applicationId,
  });

  if (insertError) {
    console.error("[privacy] request refused:", insertError.message);
    return {
      ok: false,
      message: isMissingSchemaError(insertError)
        ? PRIVACY_WRITE_REFUSAL
        : "The request could not be filed just now. Try again in a moment.",
    };
  }

  // The record is named; the person is not. The desk already sees the request,
  // and the trail outlives an erasure — so nothing here repeats the address.
  await recordActivity({
    area: "privacy",
    action: "privacy_request_filed",
    entity: "application",
    entityId: verified.applicationId,
    summary: `Filed a${plan.kind === "access" ? "n access" : "n erasure"} request through the mailed privacy link.`,
    detail: { kind: plan.kind, note_length: plan.note?.length ?? 0 },
    actorKind: "CANDIDATE",
    actorLabel: "Privacy request",
    actorId: null,
    via: "career site",
    companyId,
  });

  return {
    ok: true,
    message:
      plan.kind === "access"
        ? "Your request for a copy is filed. A recruiter will verify it and send the copy to the address on your application."
        : "Your erasure request is filed. A recruiter will verify it, and the owner will decide it. You will hear from us before anything is removed.",
  };
}

/**
 * Sends the signed link to an address that asks for one.
 *
 * The answer does not depend on whether anything matched, because an answer that
 * did would turn this page into a way to test whether somebody has applied. The
 * link is mailed to the address stored on each matching application — never to
 * the address typed — so a guess cannot divert somebody else's link.
 */
export async function requestPrivacyLink(input: {
  email: unknown;
}): Promise<PrivacyDoorResult> {
  const typed = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!typed || !EMAIL_PATTERN.test(typed)) {
    return { ok: false, message: "Enter the email address you applied with." };
  }

  if (!(await EmailConnector.isConfigured())) {
    return {
      ok: false,
      message:
        "This portal cannot send mail at the moment. Write to the group's contact address and ask for the privacy link.",
    };
  }

  const service = getServiceRestClient();
  const { data, error } = await service
    .from("applications")
    .select("id, email, erased_at")
    .in("email", emailSpellings(typed))
    .is("erased_at", null)
    .limit(LINK_REQUEST_MAX);

  if (error) {
    console.error("[privacy] link read refused:", error.message);
    return {
      ok: false,
      message: isMissingSchemaError(error)
        ? PRIVACY_WRITE_REFUSAL
        : "The link could not be sent just now. Try again in a moment.",
    };
  }

  const origin = await publicBaseUrl();
  const rows = (data ?? []) as Record<string, unknown>[];

  for (const row of rows) {
    const address = String(row.email ?? "").trim();
    if (!address) continue;

    const token = mintPrivacyToken({ applicationId: String(row.id) });
    const url = privacyLink(origin, token);

    const sent = await EmailConnector.send({
      to: address,
      subject: "Your privacy link",
      text: [
        "You asked for the link to your privacy page.",
        "",
        `Open it here within seven days: ${url}`,
        "",
        "On that page you can ask for a copy of the data held about your application, or ask for it to be erased.",
        `The page is ${origin}${PRIVACY_NOTICE_PATH} and the link is personal — please do not forward it.`,
        "",
        "If you did not ask for this, you can ignore this message. Nothing has changed.",
      ].join("\n"),
    });

    if (!sent.success) {
      console.error("[privacy] link mail failed:", sent.error);
      return {
        ok: false,
        message:
          "The mail could not be sent just now. Try again in a moment, or write to the group's contact address.",
      };
    }
  }

  return { ok: true, message: LINK_REQUEST_MESSAGE };
}

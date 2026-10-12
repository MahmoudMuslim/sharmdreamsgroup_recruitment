"""
Sharm Dreams Group - Custom HR Application
Module: sharm_dreams_hr.api.ai_recruiter
Description: AI Screening Engine connecting Frappe HR with OpenRouter LLMs.
Evaluates Job Applicants using sector-specific prompts for Hospitality, Real Estate, and Corporate.
"""

import json
import requests
import frappe
from frappe import _
from frappe.utils import cint

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free"
FALLBACK_MODEL = "qwen/qwen-2.5-72b-instruct"


def get_openrouter_api_key() -> str:
    """
    Retrieves the OpenRouter API key from site_config.json (frappe.conf)
    or falls back to system settings DocType.
    """
    key = frappe.conf.get("openrouter_api_key")
    if not key and frappe.db.exists("DocType", "Sharm Dreams HR Settings"):
        key = frappe.db.get_single_value("Sharm Dreams HR Settings", "openrouter_api_key")
    return (key or "").strip()


def build_system_prompt_for_sector(sector: str, company: str, job_title: str) -> str:
    """
    Constructs an authoritative, sector-specialized system prompt tailored for Sharm Dreams Group.
    """
    sector_guidance = ""

    if sector == "Real Estate & Development":
        sector_guidance = """
SECTOR SPECIALIZATION: REAL ESTATE & COMMERCIAL DEVELOPMENT (Sharm Dreams Commercial / Il Mercato)
You are screening for prime commercial retail, shopping centers, and Egyptian property development.
Key criteria to assess strictly:
1. Commercial Leasing & Deal Track Record: Proven history with regional tenant brands, F&B operators, and retail anchors.
2. Financial & Leasing Acumen: Mastery of minimum guaranteed rent (MGR), turnover / percentage rent, tenant fit-out CAPEX allowances, and rent roll yield optimization.
3. Egyptian Market Dynamics: Navigating currency fluctuations, Cairo vs. Sharm El Sheikh tourist retail footfall patterns, and tenant retention strategies.
"""
    elif sector == "Hospitality & Resort Ops":
        sector_guidance = """
SECTOR SPECIALIZATION: HOSPITALITY & RESORT OPERATIONS (Jaz Sharm Dreams, Fayrouz Resort, Curio Collection)
You are screening for premier Red Sea 5-star all-inclusive luxury resort operations.
Key criteria to assess strictly:
1. Multilingual Fluency: Essential fluency for Sharm El Sheikh international clientele (Russian, Italian, German, English, and Arabic). Heavy penalty if candidate lacks European languages for guest-facing roles.
2. Luxury Service & Guest Empathy: Handling TripAdvisor / Forbes standards, VIP protocols, conflict resolution under 100% occupancy stress, and guest complaint turnaround.
3. Operational Resilience: Remote Sinai resort residency adaptability, 24/7 rotating shift readiness, and charter flight arrival surges.
"""
    else:  # Corporate & Finance
        sector_guidance = """
SECTOR SPECIALIZATION: CORPORATE & SHARED SERVICES (Finance, Treasury, Procurement, Legal, Group HR)
You are screening for Sharm Dreams Group executive holding headquarters.
Key criteria to assess strictly:
1. Technical Competence: Multi-subsidiary financial consolidation, Egyptian Accounting Standards (EAS), IFRS, and Egyptian Tax Authority compliance.
2. ERP & Governance: Fluency in Frappe ERPNext / SAP, procurement integrity, and inter-company ledger reconciliation across touristic and commercial entities.
3. Treasury & Foreign Exchange: Managing CBE banking regulations, USD/EGP currency exposure, and cash repatriation from touristic revenue streams.
"""

    return f"""You are the Principal AI Recruiter and Talent Screening Director for Sharm Dreams Group in Egypt.
Target Role: {job_title or 'Unspecified'}
Target Subsidiary / Entity: {company or 'Sharm Dreams Group'}
Sector: {sector}

{sector_guidance}

EVALUATION RULES:
1. Objectively evaluate the candidate's CV against the specific position and sector requirements.
2. Be rigorous and realistic—do not award high scores to candidates lacking basic role qualifications or required languages.
3. Return ONLY a valid JSON object matching this EXACT schema:
{{
  "fit_score": <Integer between 0 and 100>,
  "summary": "<2-3 sentence executive recruiter summary highlighting specific alignment with Sharm Dreams Group>",
  "strengths": "<3-4 specific bullet points highlighting verified achievements, language fluency, or domain expertise>",
  "red_flags": "<1-3 clear bullet points highlighting potential risks, missing credentials, frequent job-hopping, or unverified claims>",
  "interview_questions": "<3-4 targeted, probing technical and situational interview questions designed to test their claims>"
}}
Do NOT output any markdown code blocks, conversational pleasantries, or preamble. Return raw JSON only."""


@frappe.whitelist()
def evaluate_job_applicant(applicant_name: str = None, doc=None, method=None) -> dict:
    """
    Main entry point to evaluate a Job Applicant.
    Accepts applicant_name (str) or doc (document instance).
    Can be called directly from JS client script or triggered via doc_events hook.
    """
    if isinstance(applicant_name, str):
        doc = frappe.get_doc("Job Applicant", applicant_name)
    elif doc is None and frappe.form_dict.get("applicant_name"):
        doc = frappe.get_doc("Job Applicant", frappe.form_dict.get("applicant_name"))
    elif doc is None:
        frappe.throw(_("Missing applicant identifier for AI evaluation."))

    # Verify write permission
    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("You do not have permission to evaluate Job Applicants."), frappe.PermissionError)

    cv_text = (doc.custom_raw_cv_text or "").strip()

    # If raw CV text is empty, attempt to parse attached PDF resume first
    if not cv_text:
        from sharm_dreams_hr.utils.cv_parser import parse_applicant_resume
        parse_result = parse_applicant_resume(doc.name)
        doc.reload()
        cv_text = (doc.custom_raw_cv_text or "").strip()

    if not cv_text:
        msg = _("Candidate has no resume text or attached PDF resume to evaluate.")
        frappe.msgprint(msg, alert=True, indicator="orange")
        return {"status": "error", "message": msg}

    api_key = get_openrouter_api_key()
    if not api_key:
        err_msg = _(
            "OpenRouter API Key not configured. Please add 'openrouter_api_key' to site_config.json "
            "or set it in Sharm Dreams HR Settings."
        )
        frappe.log_error(title="AI Recruiter: Missing API Key", message=err_msg)
        frappe.throw(err_msg)

    sector = doc.custom_business_sector or "Hospitality & Resort Ops"
    company = doc.company or "Sharm Dreams for Touristic Investment"
    job_title = doc.job_title or "Applicant"

    system_prompt = build_system_prompt_for_sector(sector, company, job_title)
    user_prompt = f"CANDIDATE CV / PROFILE TEXT FOR REVIEW:\n\n{cv_text}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sharmdreamsgroup.com",
        "X-Title": "Sharm Dreams HR AI Recruiter"
    }

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }

    try:
        response = requests.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
            timeout=45
        )

        # Handle model fallbacks if primary free model is busy
        if response.status_code != 200:
            frappe.log_error(
                title=f"AI Recruiter Primary Model Error ({response.status_code})",
                message=f"Retrying with fallback model {FALLBACK_MODEL}. Response: {response.text}"
            )
            payload["model"] = FALLBACK_MODEL
            response = requests.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload,
                timeout=45
            )

        if response.status_code != 200:
            frappe.throw(_("OpenRouter API request failed with status {0}: {1}").format(
                response.status_code, response.text
            ))

        res_data = response.json()
        raw_content = res_data["choices"][0]["message"]["content"]

        # Parse JSON output
        parsed_eval = json.loads(raw_content)

        fit_score = cint(parsed_eval.get("fit_score", 50))
        # Clamp between 0 and 100
        fit_score = max(0, min(100, fit_score))

        summary = parsed_eval.get("summary", "")
        strengths = parsed_eval.get("strengths", "")
        if isinstance(strengths, list):
            strengths = "\n• ".join([""] + strengths).strip()

        red_flags = parsed_eval.get("red_flags", "")
        if isinstance(red_flags, list):
            red_flags = "\n• ".join([""] + red_flags).strip()

        interview_questions = parsed_eval.get("interview_questions", "")
        if isinstance(interview_questions, list):
            interview_questions = "\n".join([f"{i+1}. {q}" for i, q in enumerate(interview_questions)])

        # Update Job Applicant fields atomically
        doc.db_set({
            "custom_ai_score": fit_score,
            "custom_ai_summary": summary,
            "custom_ai_strengths": strengths,
            "custom_ai_red_flags": red_flags,
            "custom_suggested_interview_questions": interview_questions,
            "status": "AI Screened" if doc.status in ["Open", "Hold"] else doc.status
        }, update_modified=True)

        # Add comment in timeline
        doc.add_comment(
            "Comment",
            text=f"<b>AI Recruiter Evaluation Completed:</b> Fit Score: <b>{fit_score}%</b>.<br>{summary}"
        )

        return {
            "status": "success",
            "message": _("AI evaluation completed successfully for candidate {0}.").format(doc.applicant_name),
            "fit_score": fit_score,
            "summary": summary,
            "strengths": strengths,
            "red_flags": red_flags,
            "interview_questions": interview_questions
        }

    except requests.exceptions.RequestException as e:
        frappe.log_error(
            title=f"OpenRouter Connection Failure: {doc.name}",
            message=frappe.get_traceback()
        )
        frappe.throw(_("Network error connecting to OpenRouter AI Gateway: {0}").format(str(e)))

    except Exception as e:
        frappe.log_error(
            title=f"AI Recruiter Exception: {doc.name}",
            message=frappe.get_traceback()
        )
        frappe.throw(_("Failed to evaluate candidate: {0}").format(str(e)))

import { FrappeSourceFile } from '../types';

export const FRAPPE_DELIVERABLES: FrappeSourceFile[] = [
  {
    name: "custom_field.json",
    path: "fixtures/custom_field.json",
    description: "DocType schema extension for Frappe HR Job Applicant (Custom Fields, Select fields, AI Scores, CV text)",
    deliverableNumber: 1,
    language: "json",
    content: `[
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "company",
    "fieldtype": "Link",
    "insert_after": "applicant_name",
    "label": "Company / Subsidiary",
    "options": "Company",
    "reqd": 1,
    "in_standard_filter": 1,
    "in_list_view": 1,
    "description": "Select the Sharm Dreams Group subsidiary (e.g. Sharm Dreams for Touristic Investment, Rowad Misr, Commercial & Real Estate, Corporate)"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_business_sector",
    "fieldtype": "Select",
    "insert_after": "company",
    "label": "Business Sector",
    "options": "Hospitality & Resort Ops\\nReal Estate & Development\\nCorporate & Finance",
    "default": "Hospitality & Resort Ops",
    "reqd": 1,
    "in_standard_filter": 1,
    "in_list_view": 1,
    "description": "Sector determines the dynamic AI screening prompts (languages, commercial leasing, or EAS accounting standards)"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_acquisition_source",
    "fieldtype": "Select",
    "insert_after": "custom_business_sector",
    "label": "Acquisition Channel",
    "options": "LinkedIn\\nWuzzuf/Bayt\\nWhatsApp Chatbot\\nDirect Career Portal\\nEmail Ingestion",
    "default": "Direct Career Portal",
    "reqd": 1,
    "in_standard_filter": 1,
    "in_list_view": 1,
    "description": "Omnichannel acquisition source of the candidate"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_section_break",
    "fieldtype": "Section Break",
    "insert_after": "cover_letter",
    "label": "AI Recruiter Evaluation (Sharm Dreams AI Hub)",
    "collapsible": 0
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_score",
    "fieldtype": "Percent",
    "insert_after": "custom_ai_section_break",
    "label": "AI Fit Score",
    "read_only": 1,
    "in_list_view": 1,
    "description": "Evaluated fit score: >= 75% High Fit (Green), 50-74% Moderate (Yellow), < 50% Low Fit (Red)"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_summary",
    "fieldtype": "Small Text",
    "insert_after": "custom_ai_score",
    "label": "AI Executive Summary",
    "read_only": 1,
    "description": "High-level summary of candidate qualifications and alignment with Sharm Dreams Group operations"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_column_break",
    "fieldtype": "Column Break",
    "insert_after": "custom_ai_summary"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_strengths",
    "fieldtype": "Text",
    "insert_after": "custom_ai_column_break",
    "label": "AI Key Strengths",
    "read_only": 1,
    "description": "Verified competencies, multilingual assets, and sector accomplishments"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_red_flags",
    "fieldtype": "Text",
    "insert_after": "custom_ai_strengths",
    "label": "AI Red Flags & Scrutiny Areas",
    "read_only": 1,
    "description": "Identified employment gaps, credential mismatches, or hospitality language concerns"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_interview_section_break",
    "fieldtype": "Section Break",
    "insert_after": "custom_ai_red_flags",
    "label": "Tailored Probing Interview Questions",
    "collapsible": 1
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_suggested_interview_questions",
    "fieldtype": "Text",
    "insert_after": "custom_interview_section_break",
    "label": "Suggested Technical & Behavioral Questions",
    "read_only": 1,
    "description": "Sector-specific questions crafted by AI to validate candidate claims during panel interviews"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_cv_section_break",
    "fieldtype": "Section Break",
    "insert_after": "custom_suggested_interview_questions",
    "label": "Extracted CV Raw Text",
    "collapsible": 1
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_raw_cv_text",
    "fieldtype": "Long Text",
    "insert_after": "custom_cv_section_break",
    "label": "Raw CV / Resume Extracted Text",
    "description": "Extracted automatically from attached PDF resumes or ingested through WhatsApp / web forms"
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_whatsapp_chat_id",
    "fieldtype": "Data",
    "insert_after": "custom_raw_cv_text",
    "label": "WhatsApp Phone ID",
    "read_only": 1,
    "description": "Meta WhatsApp Cloud API Sender Phone / ID"
  }
]`
  },
  {
    name: "cv_parser.py",
    path: "sharm_dreams_hr/utils/cv_parser.py",
    description: "PDF Resume Text Extractor (PyPDF / pdfplumber fallback, whitespace normalization, auto hook)",
    deliverableNumber: 2,
    language: "python",
    content: `"""
Sharm Dreams Group - Custom HR Application
Module: sharm_dreams_hr.utils.cv_parser
Description: High-performance PDF Resume Text Extraction for Frappe HR Job Applicant.
Supports PyPDF with pdfplumber fallback and cleans unicode/whitespace formatting.
"""

import os
import re
import frappe
from frappe import _

try:
    from pypdf import PdfReader
    PYPDF_AVAILABLE = True
except ImportError:
    try:
        from PyPDF2 import PdfReader
        PYPDF_AVAILABLE = True
    except ImportError:
        PYPDF_AVAILABLE = False

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False


def clean_extracted_text(text: str) -> str:
    """
    Cleans raw extracted PDF text:
    - Normalizes multi-newlines and spaces
    - Strips non-printable control characters while preserving Arabic & Latin characters
    """
    if not text:
        return ""
    text = text.replace("\\r\\n", "\\n").replace("\\r", "\\n")
    text = text.replace("\\u2013", "-").replace("\\u2014", "--")
    text = re.sub(r"[ \\t]+", " ", text)
    text = re.sub(r"\\n{3,}", "\\n\\n", text)
    return text.strip()


def extract_text_from_pdf_file(file_path: str) -> str:
    """
    Attempts extraction using PyPDF first for speed, falling back to pdfplumber for complex layouts.
    """
    if not os.path.exists(file_path):
        frappe.log_error(
            title="CV Parser: File Not Found",
            message=f"Requested PDF file path does not exist on disk: {file_path}"
        )
        return ""

    extracted_text = ""

    # Strategy 1: PyPDF
    if PYPDF_AVAILABLE:
        try:
            reader = PdfReader(file_path)
            pages_text = []
            for idx, page in enumerate(reader.pages):
                page_content = page.extract_text()
                if page_content:
                    pages_text.append(page_content)
            if pages_text:
                extracted_text = "\\n\\n".join(pages_text)
        except Exception as e:
            frappe.log_error(
                title="CV Parser: PyPDF Fallback Triggered",
                message=f"Failed to parse {file_path} with PyPDF: {str(e)}"
            )

    # Strategy 2: pdfplumber fallback if PyPDF yielded nothing or was unavailable
    if not extracted_text.strip() and PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(file_path) as pdf:
                pages_text = []
                for page in pdf.pages:
                    text = page.extract_text(layout=True)
                    if text:
                        pages_text.append(text)
                if pages_text:
                    extracted_text = "\\n\\n".join(pages_text)
        except Exception as e:
            frappe.log_error(
                title="CV Parser: pdfplumber Failed",
                message=f"Failed to parse {file_path} with pdfplumber: {str(e)}"
            )

    return clean_extracted_text(extracted_text)


@frappe.whitelist()
def parse_applicant_resume(applicant_name: str) -> dict:
    """
    Whitelisted API method to extract PDF resume text for a given Job Applicant.
    Can be invoked manually from form button or programmatically from workflow hooks.
    """
    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("Not permitted to update Job Applicant"), frappe.PermissionError)

    doc = frappe.get_doc("Job Applicant", applicant_name)

    attached_files = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Job Applicant",
            "attached_to_name": doc.name,
            "is_folder": 0
        },
        fields=["name", "file_name", "file_url", "is_private"],
        order_by="creation desc"
    )

    pdf_file = None
    for f in attached_files:
        filename = (f.file_name or f.file_url or "").lower()
        if filename.endswith(".pdf"):
            pdf_file = f
            break

    if not pdf_file and getattr(doc, "resume_attachment", None):
        resume_url = doc.resume_attachment.lower()
        if resume_url.endswith(".pdf"):
            pdf_file = {"file_url": doc.resume_attachment, "is_private": doc.resume_attachment.startswith("/private")}

    if not pdf_file:
        return {
            "status": "warning",
            "message": _("No PDF resume attachment found for candidate {0}.").format(applicant_name),
            "raw_text": doc.custom_raw_cv_text or ""
        }

    file_url = pdf_file["file_url"]
    site_path = frappe.get_site_path()
    
    if file_url.startswith("/private/files/"):
        abs_path = os.path.join(site_path, "private", "files", os.path.basename(file_url))
    elif file_url.startswith("/files/"):
        abs_path = os.path.join(site_path, "public", "files", os.path.basename(file_url))
    else:
        abs_path = os.path.join(site_path, file_url.lstrip("/"))

    extracted_text = extract_text_from_pdf_file(abs_path)

    if not extracted_text:
        return {
            "status": "warning",
            "message": _("Attached PDF was parsed, but no readable text could be extracted."),
            "raw_text": ""
        }

    doc.db_set("custom_raw_cv_text", extracted_text, update_modified=True)

    return {
        "status": "success",
        "message": _("Successfully extracted {0} characters from candidate resume.").format(len(extracted_text)),
        "raw_text": extracted_text[:500] + ("..." if len(extracted_text) > 500 else "")
    }


def extract_cv_on_insert(doc, method=None):
    """
    Hook handler called on doc_events -> Job Applicant -> after_insert
    """
    try:
        if doc.custom_raw_cv_text and doc.custom_raw_cv_text.strip():
            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=doc.name
            )
            return

        result = parse_applicant_resume(doc.name)
        if result.get("status") == "success":
            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=doc.name
            )
    except Exception as e:
        frappe.log_error(
            title=f"Auto CV Extraction Failed: {doc.name}",
            message=frappe.get_traceback()
        )`
  },
  {
    name: "ai_recruiter.py",
    path: "sharm_dreams_hr/api/ai_recruiter.py",
    description: "OpenRouter LLM Screening Engine (Dynamic Hospitality, Real Estate & Corporate prompts, JSON schema, fallback)",
    deliverableNumber: 3,
    language: "python",
    content: `"""
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
    key = frappe.conf.get("openrouter_api_key")
    if not key and frappe.db.exists("DocType", "Sharm Dreams HR Settings"):
        key = frappe.db.get_single_value("Sharm Dreams HR Settings", "openrouter_api_key")
    return (key or "").strip()


def build_system_prompt_for_sector(sector: str, company: str, job_title: str) -> str:
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
    else:
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
    if isinstance(applicant_name, str):
        doc = frappe.get_doc("Job Applicant", applicant_name)
    elif doc is None and frappe.form_dict.get("applicant_name"):
        doc = frappe.get_doc("Job Applicant", frappe.form_dict.get("applicant_name"))
    elif doc is None:
        frappe.throw(_("Missing applicant identifier for AI evaluation."))

    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("You do not have permission to evaluate Job Applicants."), frappe.PermissionError)

    cv_text = (doc.custom_raw_cv_text or "").strip()

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
    user_prompt = f"CANDIDATE CV / PROFILE TEXT FOR REVIEW:\\n\\n{cv_text}"

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

        if response.status_code != 200:
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
        parsed_eval = json.loads(raw_content)

        fit_score = cint(parsed_eval.get("fit_score", 50))
        fit_score = max(0, min(100, fit_score))

        summary = parsed_eval.get("summary", "")
        strengths = parsed_eval.get("strengths", "")
        if isinstance(strengths, list):
            strengths = "\\n• ".join([""] + strengths).strip()

        red_flags = parsed_eval.get("red_flags", "")
        if isinstance(red_flags, list):
            red_flags = "\\n• ".join([""] + red_flags).strip()

        interview_questions = parsed_eval.get("interview_questions", "")
        if isinstance(interview_questions, list):
            interview_questions = "\\n".join([f"{i+1}. {q}" for i, q in enumerate(interview_questions)])

        doc.db_set({
            "custom_ai_score": fit_score,
            "custom_ai_summary": summary,
            "custom_ai_strengths": strengths,
            "custom_ai_red_flags": red_flags,
            "custom_suggested_interview_questions": interview_questions,
            "status": "AI Screened" if doc.status in ["Open", "Hold"] else doc.status
        }, update_modified=True)

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

    except Exception as e:
        frappe.log_error(title=f"AI Recruiter Exception: {doc.name}", message=frappe.get_traceback())
        frappe.throw(_("Failed to evaluate candidate: {0}").format(str(e)))`
  },
  {
    name: "omnichannel.py",
    path: "sharm_dreams_hr/api/omnichannel.py",
    description: "Meta WhatsApp Cloud API Webhook, Web Chatbot intake REST API, Job Board Webhooks",
    deliverableNumber: 4,
    language: "python",
    content: `"""
Sharm Dreams Group - Custom HR Application
Module: sharm_dreams_hr.api.omnichannel
Description: Omnichannel Ingestion Gateway for Meta WhatsApp Cloud API,
Web Chatbot Portal, and Job Board Webhooks (LinkedIn Apply, Wuzzuf, Bayt).
"""

import json
import requests
import frappe
from frappe import _

WHATSAPP_API_URL = "https://graph.facebook.com/v19.0"


def get_whatsapp_credentials():
    token = frappe.conf.get("whatsapp_access_token")
    phone_number_id = frappe.conf.get("whatsapp_phone_number_id")
    verify_token = frappe.conf.get("whatsapp_verify_token") or "sharm_dreams_hr_secret_token_2026"

    if not token and frappe.db.exists("DocType", "Sharm Dreams HR Settings"):
        settings = frappe.get_single("Sharm Dreams HR Settings")
        token = settings.whatsapp_access_token
        phone_number_id = settings.whatsapp_phone_number_id
        verify_token = settings.whatsapp_verify_token or verify_token

    return {
        "access_token": token,
        "phone_number_id": phone_number_id,
        "verify_token": verify_token
    }


@frappe.whitelist(allow_guest=True)
def whatsapp_webhook():
    creds = get_whatsapp_credentials()

    if frappe.request.method == "GET":
        mode = frappe.form_dict.get("hub.mode")
        token = frappe.form_dict.get("hub.verify_token")
        challenge = frappe.form_dict.get("hub.challenge")

        if mode == "subscribe" and token == creds["verify_token"]:
            frappe.response["type"] = "text"
            frappe.response["result"] = challenge
            return challenge

        frappe.response["http_status_code"] = 403
        return "Verification token mismatch"

    if frappe.request.method == "POST":
        try:
            data = json.loads(frappe.request.data.decode("utf-8"))
        except Exception:
            data = frappe.form_dict

        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])

        if not messages:
            return {"status": "ok", "message": "No actionable message in payload"}

        msg_obj = messages[0]
        sender_wa_id = msg_obj.get("from")
        formatted_phone = f"+{sender_wa_id}" if not sender_wa_id.startswith("+") else sender_wa_id
        msg_type = msg_obj.get("type", "text")

        contacts = value.get("contacts", [{}])
        sender_name = contacts[0].get("profile", {}).get("name", "WhatsApp Candidate") if contacts else "WhatsApp Candidate"

        cv_text = ""
        if msg_type == "text":
            cv_text = msg_obj.get("text", {}).get("body", "")
        elif msg_type == "document":
            doc_info = msg_obj.get("document", {})
            attachment_name = doc_info.get("filename", "resume.pdf")
            media_id = doc_info.get("id")
            cv_text = f"[Attached Document: {attachment_name} (Media ID: {media_id})]"

        existing_applicant = frappe.db.get_value(
            "Job Applicant",
            {"phone_number": ["in", [sender_wa_id, formatted_phone]]},
            ["name", "status"],
            as_dict=True
        )

        if existing_applicant:
            app_doc = frappe.get_doc("Job Applicant", existing_applicant.name)
            current_cv = app_doc.custom_raw_cv_text or ""
            app_doc.custom_raw_cv_text = f"{current_cv}\\n\\n[WhatsApp Update - {frappe.utils.now()}]:\\n{cv_text}"
            app_doc.custom_whatsapp_chat_id = sender_wa_id
            app_doc.save(ignore_permissions=True)

            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=app_doc.name
            )
            applicant_name = app_doc.name
        else:
            app_doc = frappe.get_doc({
                "doctype": "Job Applicant",
                "applicant_name": sender_name,
                "email_address": f"{sender_wa_id}@whatsapp.sharmdreams.eg",
                "phone_number": formatted_phone,
                "company": "Sharm Dreams for Touristic Investment",
                "custom_business_sector": "Hospitality & Resort Ops",
                "custom_acquisition_source": "WhatsApp Chatbot",
                "custom_raw_cv_text": cv_text,
                "custom_whatsapp_chat_id": sender_wa_id,
                "status": "Open"
            })
            app_doc.insert(ignore_permissions=True)
            frappe.db.commit()

            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=app_doc.name
            )
            applicant_name = app_doc.name

        return {
            "status": "success",
            "applicant": applicant_name,
            "message": "Candidate processed from WhatsApp successfully"
        }


@frappe.whitelist(allow_guest=True)
def web_chatbot_submit():
    try:
        if frappe.request.content_type == "application/json":
            payload = json.loads(frappe.request.data.decode("utf-8"))
        else:
            payload = frappe.form_dict

        name = payload.get("applicant_name")
        email = payload.get("email_address")
        phone = payload.get("phone_number")
        company = payload.get("company", "Sharm Dreams for Touristic Investment")
        sector = payload.get("custom_business_sector", "Hospitality & Resort Ops")
        job_title = payload.get("job_title", "Candidate")
        cv_text = payload.get("custom_raw_cv_text", "")

        if not name or not email:
            frappe.response["http_status_code"] = 400
            return {"status": "error", "message": "Applicant name and email address are required."}

        if frappe.db.exists("Job Applicant", {"email_address": email}):
            existing = frappe.get_doc("Job Applicant", {"email_address": email})
            existing.custom_raw_cv_text = cv_text or existing.custom_raw_cv_text
            existing.save(ignore_permissions=True)
            applicant_name = existing.name
        else:
            doc = frappe.get_doc({
                "doctype": "Job Applicant",
                "applicant_name": name,
                "email_address": email,
                "phone_number": phone,
                "company": company,
                "job_title": job_title,
                "custom_business_sector": sector,
                "custom_acquisition_source": "Direct Career Portal",
                "custom_raw_cv_text": cv_text,
                "status": "Open"
            })
            doc.insert(ignore_permissions=True)
            applicant_name = doc.name

        frappe.db.commit()

        frappe.enqueue(
            "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
            queue="short",
            applicant_name=applicant_name
        )

        return {
            "status": "success",
            "applicant_name": applicant_name,
            "message": _("Application received. Automated AI screening initiated.")
        }
    except Exception as e:
        frappe.log_error(title="Web Chatbot Ingestion Failed", message=frappe.get_traceback())
        frappe.response["http_status_code"] = 500
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=True)
def job_board_webhook():
    try:
        if frappe.request.content_type == "application/json":
            payload = json.loads(frappe.request.data.decode("utf-8"))
        else:
            payload = frappe.form_dict

        source = payload.get("source", "LinkedIn")
        candidate = payload.get("candidate", payload)

        name = candidate.get("name") or candidate.get("applicant_name")
        email = candidate.get("email") or candidate.get("email_address")
        phone = candidate.get("phone") or candidate.get("phone_number")
        cv_text = candidate.get("cv_text") or candidate.get("resume_text") or ""
        job_title = candidate.get("job_title") or payload.get("job_title", "Candidate")
        company = payload.get("company", "Rowad Misr for Tourism Investment")
        sector = payload.get("sector", "Hospitality & Resort Ops")

        if not name or not email:
            frappe.response["http_status_code"] = 400
            return {"status": "error", "message": "Missing candidate name or email."}

        doc = frappe.get_doc({
            "doctype": "Job Applicant",
            "applicant_name": name,
            "email_address": email,
            "phone_number": phone,
            "company": company,
            "job_title": job_title,
            "custom_business_sector": sector,
            "custom_acquisition_source": "Wuzzuf/Bayt" if "wuzzuf" in source.lower() or "bayt" in source.lower() else "LinkedIn",
            "custom_raw_cv_text": cv_text,
            "status": "Open"
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.enqueue(
            "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
            queue="short",
            applicant_name=doc.name
        )

        return {
            "status": "success",
            "applicant_name": doc.name,
            "source": source
        }
    except Exception as e:
        frappe.log_error(title="Job Board Webhook Failure", message=frappe.get_traceback())
        frappe.response["http_status_code"] = 500
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def send_whatsapp_interview_invite(applicant_name: str, interview_datetime: str = None, location: str = None):
    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("Permission denied."))

    doc = frappe.get_doc("Job Applicant", applicant_name)
    phone = (doc.phone_number or doc.custom_whatsapp_chat_id or "").replace(" ", "").replace("-", "")

    if not phone:
        frappe.throw(_("Candidate does not have a valid phone number for WhatsApp."))

    clean_phone = phone.lstrip("+")
    creds = get_whatsapp_credentials()

    message_body = (
        f"Dear {doc.applicant_name},\\n\\n"
        f"Thank you for your interest in joining Sharm Dreams Group ({doc.company or 'Holding'}).\\n"
        f"Following your impressive initial screening for the position of {doc.job_title or 'the applied role'}, "
        f"we are pleased to invite you for an interview.\\n\\n"
        f"📅 Date & Time: {interview_datetime or 'To be coordinated'}\\n"
        f"📍 Location / Format: {location or 'HR Talent Office / Google Meet'}\\n\\n"
        f"Please reply to this WhatsApp message to confirm your availability.\\n\\n"
        f"Best regards,\\n"
        f"Talent Acquisition Team\\n"
        f"Sharm Dreams Group"
    )

    if not creds.get("access_token") or not creds.get("phone_number_id"):
        doc.add_comment(
            "Comment",
            text=f"<b>WhatsApp Invite Drafted:</b><br><pre>{message_body}</pre><br>"
                 f"<i>(Note: Add Meta WhatsApp Cloud API access token in site config to enable automated dispatch)</i>"
        )
        doc.status = "Interview Scheduled"
        doc.save()
        return {
            "status": "warning",
            "message": _("WhatsApp credentials not set. Simulated invite logged to candidate timeline."),
            "message_body": message_body
        }

    url = f"{WHATSAPP_API_URL}/{creds['phone_number_id']}/messages"
    headers = {
        "Authorization": f"Bearer {creds['access_token']}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": clean_phone,
        "type": "text",
        "text": {"body": message_body}
    }

    try:
        res = requests.post(url, headers=headers, json=payload, timeout=20)
        if res.status_code == 200:
            doc.add_comment("Comment", text=f"<b>WhatsApp Invite Sent to {clean_phone}:</b><br>{message_body}")
            doc.status = "Interview Scheduled"
            doc.save()
            return {"status": "success", "message": _("Interview invitation dispatched via WhatsApp!")}
        else:
            frappe.log_error("WhatsApp API Dispatch Error", res.text)
            frappe.throw(_("WhatsApp API returned error: {0}").format(res.text))
    except Exception as e:
        frappe.log_error("WhatsApp Dispatch Failed", frappe.get_traceback())
        frappe.throw(_("Could not connect to WhatsApp Cloud API: {0}").format(str(e)))`
  },
  {
    name: "job_applicant.js",
    path: "sharm_dreams_hr/public/js/job_applicant.js",
    description: "Frappe Form UI extension ('Run AI Evaluation' button, wa.me chat trigger, interview invite dialog, color-coded score indicator)",
    deliverableNumber: 5,
    language: "javascript",
    content: `/**
 * Sharm Dreams Group - Custom HR Application
 * Client Script: Job Applicant Form Extension
 * File: sharm_dreams_hr/public/js/job_applicant.js
 * Description: Adds AI Recruiter Actions, WhatsApp Direct Chat/Invite, and Color-Coded Fit Scores.
 */

frappe.ui.form.on('Job Applicant', {
    refresh: function(frm) {
        apply_ai_score_indicator_styling(frm);

        if (!frm.is_new()) {
            setup_ai_recruiter_action_buttons(frm);
            setup_whatsapp_action_buttons(frm);
            setup_cv_parser_action_buttons(frm);
        }
    },

    custom_ai_score: function(frm) {
        apply_ai_score_indicator_styling(frm);
    }
});

function setup_ai_recruiter_action_buttons(frm) {
    frm.add_custom_button(__('Run AI Evaluation'), function() {
        frappe.confirm(
            __('Run automated AI screening for candidate <b>{0}</b> based on sector <b>{1}</b>?', [
                frm.doc.applicant_name,
                frm.doc.custom_business_sector || 'Hospitality'
            ]),
            function() {
                frappe.show_progress(__('Screening Candidate'), 40, 100, __('Consulting OpenRouter LLM...'));

                frappe.call({
                    method: 'sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant',
                    args: {
                        applicant_name: frm.doc.name
                    },
                    freeze: true,
                    freeze_message: __('Sharm Dreams AI Hub is screening candidate profile and CV...'),
                    callback: function(r) {
                        frappe.hide_progress();
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({
                                message: __('AI Evaluation Complete: Fit Score {0}%', [r.message.fit_score]),
                                indicator: r.message.fit_score >= 75 ? 'green' : (r.message.fit_score >= 50 ? 'orange' : 'red')
                            }, 7);
                            frm.reload_doc();
                        } else {
                            frappe.msgprint({
                                title: __('AI Recruiter Notice'),
                                message: r.message ? r.message.message : __('Evaluation completed.'),
                                indicator: 'blue'
                            });
                            frm.reload_doc();
                        }
                    },
                    error: function(err) {
                        frappe.hide_progress();
                        frappe.msgprint({
                            title: __('Evaluation Failed'),
                            message: __('Check OpenRouter API key configuration in site_config.json'),
                            indicator: 'red'
                        });
                    }
                });
            }
        );
    }, __('AI Actions')).addClass('btn-primary');
}

function setup_whatsapp_action_buttons(frm) {
    var rawPhone = frm.doc.phone_number || frm.doc.custom_whatsapp_chat_id || '';
    var cleanPhone = rawPhone.replace(/\\D/g, '');

    frm.add_custom_button(__('Open WhatsApp Chat'), function() {
        if (!cleanPhone) {
            frappe.msgprint(__('Candidate does not have a phone number specified.'));
            return;
        }

        var message = encodeURIComponent(
            \`Hello \${frm.doc.applicant_name}, this is Talent Acquisition from Sharm Dreams Group regarding your application for \${frm.doc.job_title || 'the open position'}.\`
        );
        var waUrl = \`https://wa.me/\${cleanPhone}?text=\${message}\`;
        window.open(waUrl, '_blank');
    }, __('WhatsApp'));

    frm.add_custom_button(__('Send Interview Invite'), function() {
        if (!cleanPhone) {
            frappe.msgprint(__('Candidate has no valid phone number.'));
            return;
        }

        var d = new frappe.ui.Dialog({
            title: __('Schedule WhatsApp Interview Invite'),
            fields: [
                {
                    label: __('Candidate Name'),
                    fieldname: 'candidate_name',
                    fieldtype: 'Data',
                    default: frm.doc.applicant_name,
                    read_only: 1
                },
                {
                    label: __('Target Subsidiary'),
                    fieldname: 'company',
                    fieldtype: 'Data',
                    default: frm.doc.company || 'Sharm Dreams Group',
                    read_only: 1
                },
                {
                    label: __('Proposed Date & Time'),
                    fieldname: 'interview_datetime',
                    fieldtype: 'Datetime',
                    reqd: 1,
                    default: frappe.datetime.add_days(frappe.datetime.now_datetime(), 2)
                },
                {
                    label: __('Interview Location / Platform'),
                    fieldname: 'location',
                    fieldtype: 'Select',
                    options: 'Resort HR Office (Sharm El Sheikh)\\nCairo Executive HQ (Mohandessin)\\nOnline (Google Meet / Microsoft Teams)',
                    default: 'Resort HR Office (Sharm El Sheikh)',
                    reqd: 1
                }
            ],
            primary_action_label: __('Send via WhatsApp'),
            primary_action: function(values) {
                d.hide();
                frappe.call({
                    method: 'sharm_dreams_hr.api.omnichannel.send_whatsapp_interview_invite',
                    args: {
                        applicant_name: frm.doc.name,
                        interview_datetime: values.interview_datetime,
                        location: values.location
                    },
                    freeze: true,
                    freeze_message: __('Dispatching WhatsApp invitation...'),
                    callback: function(res) {
                        if (res.message) {
                            frappe.show_alert({
                                message: res.message.message,
                                indicator: res.message.status === 'success' ? 'green' : 'orange'
                            }, 5);
                            frm.reload_doc();
                        }
                    }
                });
            }
        });
        d.show();
    }, __('WhatsApp'));
}

function setup_cv_parser_action_buttons(frm) {
    frm.add_custom_button(__('Extract CV Text from PDF'), function() {
        frappe.call({
            method: 'sharm_dreams_hr.utils.cv_parser.parse_applicant_resume',
            args: {
                applicant_name: frm.doc.name
            },
            freeze: true,
            freeze_message: __('Parsing attached PDF resume with PyPDF...'),
            callback: function(r) {
                if (r.message) {
                    frappe.show_alert({
                        message: r.message.message,
                        indicator: r.message.status === 'success' ? 'green' : 'orange'
                    });
                    frm.reload_doc();
                }
            }
        });
    }, __('AI Actions'));
}

function apply_ai_score_indicator_styling(frm) {
    var score = frm.doc.custom_ai_score;
    if (score === null || score === undefined || score === '') {
        frm.page.set_indicator(__('Unscreened'), 'gray');
        return;
    }

    score = flt(score);

    var indicatorColor = 'red';
    var label = __('Low Fit ({0}%)', [score]);

    if (score >= 75) {
        indicatorColor = 'green';
        label = __('Strong Match ({0}%)', [score]);
    } else if (score >= 50) {
        indicatorColor = 'orange';
        label = __('Moderate Match ({0}%)', [score]);
    }

    frm.page.set_indicator(label, indicatorColor);

    setTimeout(function() {
        var $field = frm.get_field('custom_ai_score');
        if ($field && $field.$wrapper) {
            $field.$wrapper.find('.control-value').css({
                'font-weight': '700',
                'font-size': '1.2rem',
                'color': score >= 75 ? '#10b981' : (score >= 50 ? '#f59e0b' : '#ef4444')
            });
        }
    }, 200);
}`
  },
  {
    name: "hooks.py",
    path: "sharm_dreams_hr/hooks.py",
    description: "Frappe Hooks Configuration (registers after_insert CV parser & AI evaluation event, doctype_js, fixtures export)",
    deliverableNumber: 6,
    language: "python",
    content: `"""
Sharm Dreams Group - Custom HR Application
Hooks Configuration
File: sharm_dreams_hr/hooks.py
"""

app_name = "sharm_dreams_hr"
app_title = "Sharm Dreams HR"
app_publisher = "Sharm Dreams Group"
app_description = "Omnichannel AI ATS & Recruiter for Sharm Dreams Group (Hospitality, Real Estate, Corporate)"
app_email = "it@sharmdreamsgroup.com"
app_license = "MIT"
app_version = "1.0.0"

# DocType JavaScript Extensions
doctype_js = {
    "Job Applicant": "public/js/job_applicant.js"
}

# Document Events
# Hook on Job Applicant after_insert to automatically extract CV text and trigger AI evaluation
doc_events = {
    "Job Applicant": {
        "after_insert": "sharm_dreams_hr.utils.cv_parser.extract_cv_on_insert"
    }
}

# Fixtures
fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            ["dt", "=", "Job Applicant"],
            ["fieldname", "in", [
                "company",
                "custom_business_sector",
                "custom_acquisition_source",
                "custom_ai_section_break",
                "custom_ai_score",
                "custom_ai_summary",
                "custom_ai_column_break",
                "custom_ai_strengths",
                "custom_ai_red_flags",
                "custom_interview_section_break",
                "custom_suggested_interview_questions",
                "custom_cv_section_break",
                "custom_raw_cv_text",
                "custom_whatsapp_chat_id"
            ]]
        ]
    }
]`
  },
  {
    name: "pyproject.toml",
    path: "pyproject.toml",
    description: "App package metadata and dependencies (pypdf, pdfplumber, requests, frappe>=15, hrms>=15)",
    deliverableNumber: 7,
    language: "toml",
    content: `[project]
name = "sharm_dreams_hr"
authors = [
    { name = "Sharm Dreams Group IT & HR Architecture", email = "it@sharmdreamsgroup.com" }
]
description = "Omnichannel AI ATS & Recruiter for Sharm Dreams Group extending Frappe HR"
requires-python = ">=3.10"
readme = "README.md"
dynamic = ["version"]
dependencies = [
    "pypdf>=3.17.0",
    "pdfplumber>=0.10.3",
    "requests>=2.31.0"
]

[build-system]
requires = ["flit_core >=3.4,<4"]
build-backend = "flit_core.buildapi"

[tool.bench.frappe-dependencies]
frappe = ">=15.0.0"
hrms = ">=15.0.0"`
  },
  {
    name: "README.md",
    path: "README.md",
    description: "Complete Frappe Bench deployment guide (bench get-app, bench migrate, site_config.json setup, OpenRouter setup)",
    deliverableNumber: 8,
    language: "markdown",
    content: `# Sharm Dreams HR (\`sharm_dreams_hr\`)
**Omnichannel AI-Powered ATS & Recruiter for Sharm Dreams Group**
*Extending Frappe HR (\`hrms\`) on Frappe Framework v15/v16*

---

## 🏨 About Sharm Dreams Group Architecture

This custom Frappe app coordinates talent acquisition across the 4 core holding subsidiaries:
1. **Sharm Dreams for Touristic Investment** (Hospitality, Luxury Resorts: Jaz Sharm Dreams, Fayrouz, Hilton Curio Collection).
2. **Rowad Misr for Tourism Investment** (Hotel & Resort Operations).
3. **Commercial & Real Estate Development** (Il Mercato Shopping Center, Real Estate Sales, Residential Projects).
4. **Corporate & Shared Services** (Finance, Treasury, Procurement, Legal, Group HR).

---

## ⚡ Key Features

- **Omnichannel Ingestion:** Meta WhatsApp Cloud API webhooks (\`wa.me\`), interactive Web Chatbot REST API, and Job Board webhooks (LinkedIn, Wuzzuf, Bayt).
- **CV Parsing:** PyPDF & pdfplumber extraction from attached PDF resumes into \`custom_raw_cv_text\`.
- **Dynamic Sector AI Screening:** OpenRouter AI integration with tailored prompts for:
  - **Hospitality:** European language fluency (Russian, Italian, German, English), luxury guest empathy, 24/7 resort shifts.
  - **Real Estate:** Commercial leasing track record, minimum guaranteed vs turnover rent, fit-out CAPEX modeling, Egyptian retail market.
  - **Corporate & Finance:** Multi-subsidiary holding consolidation, EAS/IFRS accounting, CBE foreign currency regulations, ERP governance.
- **Form Enhancements:** Color-coded fit scores (Green ≥ 75%, Orange 50-74%, Red < 50%), 1-click WhatsApp chat, and automated WhatsApp interview scheduling.

---

## 🚀 Quick Installation on Frappe Bench

\`\`\`bash
# 1. In Frappe Manager or Bench Shell:
cd /workspace/frappe-bench

# 2. Get the app:
bench get-app https://github.com/sharm-dreams-group/sharm_dreams_hr.git

# 3. Install on target site:
bench --site [your-site-name] install-app sharm_dreams_hr

# 4. Migrate database fixtures:
bench --site [your-site-name] migrate

# 5. Add API keys in sites/[your-site-name]/site_config.json:
# "openrouter_api_key": "sk-or-v1-..."
# "whatsapp_access_token": "EAA..."
# "whatsapp_phone_number_id": "100987654321"

# 6. Restart bench:
bench restart
\`\`\``
  }
];

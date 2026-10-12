"""
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
    # Normalize carriage returns and weird unicode dashes
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u2013", "-").replace("\u2014", "--")
    # Replace excessive horizontal whitespace with a single space
    text = re.sub(r"[ \t]+", " ", text)
    # Replace more than 2 consecutive newlines with 2 newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
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
                extracted_text = "\n\n".join(pages_text)
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
                    extracted_text = "\n\n".join(pages_text)
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

    # Search for attached PDF files in Frappe File doctype
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

    # Also check if resume_attachment field contains a file url
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

    # Resolve absolute path on disk
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
            "message": _("Attached PDF was parsed, but no readable text could be extracted (it may be a scanned image)."),
            "raw_text": ""
        }

    # Save to Job Applicant
    doc.db_set("custom_raw_cv_text", extracted_text, update_modified=True)

    return {
        "status": "success",
        "message": _("Successfully extracted {0} characters from candidate resume.").format(len(extracted_text)),
        "raw_text": extracted_text[:500] + ("..." if len(extracted_text) > 500 else "")
    }


def extract_cv_on_insert(doc, method=None):
    """
    Hook handler called on doc_events -> Job Applicant -> after_insert
    Parses resume and initiates AI evaluation if CV attachment or raw text is present.
    """
    try:
        # If raw text is already provided (e.g. from WhatsApp/Web form), trigger evaluation directly
        if doc.custom_raw_cv_text and doc.custom_raw_cv_text.strip():
            # Trigger asynchronous or background evaluation
            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=doc.name
            )
            return

        # Otherwise attempt extraction if an attachment is attached immediately
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
        )

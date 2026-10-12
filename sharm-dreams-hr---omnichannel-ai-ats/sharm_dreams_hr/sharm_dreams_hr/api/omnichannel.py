"""
Sharm Dreams Group - Custom HR Application
Module: sharm_dreams_hr.api.omnichannel
Description: Omnichannel Ingestion Gateway for Meta WhatsApp Cloud API,
Web Chatbot Portal, and Job Board Webhooks (LinkedIn Apply, Wuzzuf, Bayt).
"""

import json
import requests
import frappe
from frappe import _

# Meta WhatsApp Cloud API Configuration
WHATSAPP_API_URL = "https://graph.facebook.com/v19.0"


def get_whatsapp_credentials():
    """
    Fetches Meta WhatsApp credentials from frappe.conf or Sharm Dreams HR Settings
    """
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
    """
    Meta WhatsApp Cloud API Webhook Endpoint.
    GET: Handles Meta Webhook Verification handshake.
    POST: Ingests incoming messages, matches candidate phone, and triggers AI evaluation.
    """
    creds = get_whatsapp_credentials()

    # 1. Handle Webhook Verification Handshake (GET)
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

    # 2. Handle Incoming WhatsApp Message (POST)
    if frappe.request.method == "POST":
        try:
            data = json.loads(frappe.request.data.decode("utf-8"))
        except Exception:
            data = frappe.form_dict

        # Basic validation of WhatsApp payload
        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])

        if not messages:
            return {"status": "ok", "message": "No actionable message in payload"}

        msg_obj = messages[0]
        sender_wa_id = msg_obj.get("from")  # e.g., "201023456789"
        formatted_phone = f"+{sender_wa_id}" if not sender_wa_id.startswith("+") else sender_wa_id
        msg_type = msg_obj.get("type", "text")

        # Contact info
        contacts = value.get("contacts", [{}])
        sender_name = contacts[0].get("profile", {}).get("name", "WhatsApp Candidate") if contacts else "WhatsApp Candidate"

        cv_text = ""
        attachment_name = None

        if msg_type == "text":
            cv_text = msg_obj.get("text", {}).get("body", "")
        elif msg_type == "document":
            doc_info = msg_obj.get("document", {})
            attachment_name = doc_info.get("filename", "resume.pdf")
            media_id = doc_info.get("id")
            cv_text = f"[Attached Document: {attachment_name} (Media ID: {media_id})]"

        # Check if an existing applicant exists with this phone number
        existing_applicant = frappe.db.get_value(
            "Job Applicant",
            {"phone_number": ["in", [sender_wa_id, formatted_phone]]},
            ["name", "status"],
            as_dict=True
        )

        if existing_applicant:
            # Update existing applicant record with new message history
            app_doc = frappe.get_doc("Job Applicant", existing_applicant.name)
            current_cv = app_doc.custom_raw_cv_text or ""
            app_doc.custom_raw_cv_text = f"{current_cv}\n\n[WhatsApp Update - {frappe.utils.now()}]:\n{cv_text}"
            app_doc.custom_whatsapp_chat_id = sender_wa_id
            app_doc.save(ignore_permissions=True)

            frappe.enqueue(
                "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
                queue="short",
                applicant_name=app_doc.name
            )

            applicant_name = app_doc.name
        else:
            # Create new Job Applicant document
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

            # Trigger background AI recruiter screening
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
    """
    Public Whitelisted Endpoint for Website Career Chatbot & Application Form.
    Accepts candidate profile, resume text or attachment, and triggers AI evaluation.
    """
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

        # Check duplicate
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

        # Enqueue AI evaluation
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
    """
    Generic Webhook Endpoint for LinkedIn Apply, Wuzzuf, and Bayt aggregators.
    """
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

        # Enqueue evaluation
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
    """
    Sends an automated WhatsApp interview invitation to the candidate using Meta WhatsApp Cloud API.
    """
    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("Permission denied."))

    doc = frappe.get_doc("Job Applicant", applicant_name)
    phone = (doc.phone_number or doc.custom_whatsapp_chat_id or "").replace(" ", "").replace("-", "")

    if not phone:
        frappe.throw(_("Candidate does not have a valid phone number for WhatsApp."))

    # Remove leading plus for WhatsApp API destination
    clean_phone = phone.lstrip("+")
    creds = get_whatsapp_credentials()

    message_body = (
        f"Dear {doc.applicant_name},\n\n"
        f"Thank you for your interest in joining Sharm Dreams Group ({doc.company or 'Holding'}).\n"
        f"Following your impressive initial screening for the position of {doc.job_title or 'the applied role'}, "
        f"we are pleased to invite you for an interview.\n\n"
        f"📅 Date & Time: {interview_datetime or 'To be coordinated'}\n"
        f"📍 Location / Format: {location or 'HR Talent Office / Google Meet'}\n\n"
        f"Please reply to this WhatsApp message to confirm your availability.\n\n"
        f"Best regards,\n"
        f"Talent Acquisition Team\n"
        f"Sharm Dreams Group"
    )

    if not creds.get("access_token") or not creds.get("phone_number_id"):
        # Log to timeline as simulated dispatch
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
        frappe.throw(_("Could not connect to WhatsApp Cloud API: {0}").format(str(e)))

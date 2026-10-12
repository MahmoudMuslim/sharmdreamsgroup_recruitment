---
name: frappe-manager-custom-app
description: >
  Designs, develops, tests, and deploys production-grade custom applications on
  Frappe Framework v15/v16 using Frappe Manager (Docker-based bench) or standalone
  bench environments. Specializes in DocType fixtures, hooks.py configuration,
  client scripts, whitelisted REST/Webhook APIs, asynchronous job queuing (frappe.enqueue),
  and third-party AI integrations (OpenRouter, Meta WhatsApp Cloud API).
---

# Frappe Manager Custom App Development Skill

## Overview

Frappe Framework is a full-stack Python/JavaScript meta-framework. Frappe Manager manages Docker containers running `frappe-bench`. This skill provides architectural patterns, directory conventions, and operational runbooks for developing custom apps like `sharm_dreams_hr` that extend core modules like Frappe HR (`hrms`) or ERPNext.

---

## App Scaffolding & Directory Conventions

A custom Frappe app must follow standard Frappe packaging standards:

```
[app_name]/
├── [app_name]/                  # Python package root
│   ├── __init__.py              # __version__ = "1.0.0"
│   ├── hooks.py                 # Core event registry & metadata
│   ├── api/                     # Whitelisted endpoints & Webhooks
│   │   ├── __init__.py
│   │   └── [module].py
│   ├── utils/                   # Helper scripts (PDF parsers, formatters)
│   │   ├── __init__.py
│   │   └── cv_parser.py
│   ├── fixtures/                # JSON fixtures for Custom Fields & Roles
│   │   └── custom_field.json
│   └── public/                  # Frontend assets injected into desk
│       ├── js/                  # Form Client Scripts (doctype_js)
│       └── css/                 # Custom styling
├── pyproject.toml               # Python package metadata & dependencies
├── setup.py                     # Legacy fallback
└── README.md
```

---

## Key Development Patterns

### 1. Custom Fields Definition (`fixtures/custom_field.json`)
Never alter standard DocTypes directly in the database. Use `Custom Field` fixtures that migrate automatically with `bench migrate`:

```json
[
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_business_sector",
    "fieldtype": "Select",
    "insert_after": "applicant_name",
    "label": "Business Sector",
    "options": "Hospitality & Resort Ops\nReal Estate & Development\nCorporate & Finance",
    "default": "Hospitality & Resort Ops",
    "reqd": 1,
    "in_standard_filter": 1,
    "in_list_view": 1
  },
  {
    "docstatus": 0,
    "doctype": "Custom Field",
    "dt": "Job Applicant",
    "fieldname": "custom_ai_score",
    "fieldtype": "Percent",
    "insert_after": "status",
    "label": "AI Fit Score",
    "read_only": 1,
    "in_list_view": 1
  }
]
```

### 2. Event Registry (`hooks.py`)
Wire client scripts, document triggers, and fixtures in `hooks.py`:

```python
app_name = "sharm_dreams_hr"
app_title = "Sharm Dreams HR"
app_publisher = "Sharm Dreams Group"
app_description = "Omnichannel AI ATS for Frappe HR"
app_version = "1.0.0"

# Inject Client Scripts into Form Views
doctype_js = {
    "Job Applicant": "public/js/job_applicant.js"
}

# Document Lifecycle Events
doc_events = {
    "Job Applicant": {
        "after_insert": "sharm_dreams_hr.utils.cv_parser.extract_cv_on_insert"
    }
}

# Database Migration Fixtures
fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            ["dt", "=", "Job Applicant"],
            ["fieldname", "like", "custom_%"]
        ]
    }
]
```

### 3. Secure Whitelisted Python APIs (`api/*.py`)
Always use `@frappe.whitelist()` and check user permissions:

```python
import frappe
from frappe import _

@frappe.whitelist()
def evaluate_candidate(applicant_name: str) -> dict:
    # 1. Enforce permission checks
    if not frappe.has_permission("Job Applicant", "write"):
        frappe.throw(_("Not permitted to evaluate applicants."), frappe.PermissionError)

    doc = frappe.get_doc("Job Applicant", applicant_name)

    # 2. Retrieve secure credentials from site_config.json
    api_key = frappe.conf.get("openrouter_api_key")
    if not api_key:
        frappe.throw(_("Missing OpenRouter API key in site_config.json"))

    # 3. Commit updates atomically
    doc.db_set({
        "custom_ai_score": 88,
        "status": "AI Screened"
    }, update_modified=True)

    # 4. Add comment to timeline
    doc.add_comment("Comment", text="<b>AI Evaluation Completed:</b> 88% Match.")

    return {"status": "success", "score": 88}
```

### 4. Background Task Offloading (`frappe.enqueue`)
Never block the main HTTP request thread with LLM calls or PDF parsing. Use Frappe's Redis queue:

```python
# Offload to background worker
frappe.enqueue(
    "sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant",
    queue="short",            # 'short', 'default', or 'long'
    timeout=300,
    applicant_name=doc.name
)
```

### 5. Client Script Form Extensions (`public/js/*.js`)
```javascript
frappe.ui.form.on('Job Applicant', {
    refresh: function(frm) {
        if (!frm.is_new()) {
            // Add custom action button
            frm.add_custom_button(__('Run AI Evaluation'), function() {
                frappe.show_progress(__('Evaluating'), 50, 100);
                frappe.call({
                    method: 'sharm_dreams_hr.api.ai_recruiter.evaluate_candidate',
                    args: { applicant_name: frm.doc.name },
                    callback: function(r) {
                        frappe.hide_progress();
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({ message: __('Evaluated!'), indicator: 'green' });
                            frm.reload_doc();
                        }
                    }
                });
            }, __('AI Actions')).addClass('btn-primary');
        }

        // Color-code score badge
        if (frm.doc.custom_ai_score) {
            var color = frm.doc.custom_ai_score >= 75 ? 'green' : 'orange';
            frm.page.set_indicator(__('Score: {0}%', [frm.doc.custom_ai_score]), color);
        }
    }
});
```

---

## Frappe Manager & Bench CLI Runbook

```bash
# 1. Enter Frappe Manager bench container
fm enter [site_container_name]
# Or in native Docker:
docker exec -it frappe-bench-container bash

# 2. Navigate to bench directory
cd /workspace/frappe-bench

# 3. Create or clone custom app
bench get-app https://github.com/sharm-dreams-group/sharm_dreams_hr.git

# 4. Install custom app on active site
bench --site [site_name] install-app sharm_dreams_hr

# 5. Run database migrations to install fixtures
bench --site [site_name] migrate

# 6. Set site configuration secrets
bench --site [site_name] set-config openrouter_api_key "sk-or-v1-..."
bench --site [site_name] set-config whatsapp_verify_token "sharm_dreams_hr_secret_token_2026"

# 7. Execute method directly via CLI for testing
bench --site [site_name] execute sharm_dreams_hr.api.ai_recruiter.evaluate_candidate --kwargs '{"applicant_name": "HR-APP-2026-00001"}'

# 8. Restart bench services
bench restart
```

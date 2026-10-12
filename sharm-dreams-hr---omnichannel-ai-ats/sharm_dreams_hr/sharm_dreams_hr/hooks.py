"""
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

# Includes in <head>
# ------------------
# include js, css files in header of desk.html
# app_include_css = "/assets/sharm_dreams_hr/css/sharm_dreams_hr.css"
# app_include_js = "/assets/sharm_dreams_hr/js/sharm_dreams_hr.js"

# DocType JavaScript Extensions
# -----------------------------
doctype_js = {
    "Job Applicant": "public/js/job_applicant.js"
}

# Document Events
# ---------------
# Hook on Job Applicant after_insert to automatically extract CV text and trigger AI evaluation
doc_events = {
    "Job Applicant": {
        "after_insert": "sharm_dreams_hr.utils.cv_parser.extract_cv_on_insert"
    }
}

# Fixtures
# --------
# Exports Custom Fields automatically so they are migrated on bench migrate
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
]

# Scheduled Tasks
# ---------------
# scheduler_events = {
#     "hourly": [
#         "sharm_dreams_hr.api.ai_recruiter.retry_pending_screenings"
#     ]
# }

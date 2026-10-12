# Sharm Dreams HR (`sharm_dreams_hr`)
**Omnichannel AI-Powered ATS & Recruiter for Sharm Dreams Group**
*Extending Frappe HR (`hrms`) on Frappe Framework v15/v16*

---

## 🏨 About Sharm Dreams Group Architecture

This custom Frappe app coordinates talent acquisition across the 4 core holding subsidiaries:
1. **Sharm Dreams for Touristic Investment** (Hospitality, Luxury Resorts: Jaz Sharm Dreams, Fayrouz, Hilton Curio Collection).
2. **Rowad Misr for Tourism Investment** (Hotel & Resort Operations).
3. **Commercial & Real Estate Development** (Il Mercato Shopping Center, Real Estate Sales, Residential Projects).
4. **Corporate & Shared Services** (Finance, Treasury, Procurement, Legal, Group HR).

---

## ⚡ Key Features

- **Omnichannel Ingestion:** Meta WhatsApp Cloud API webhooks (`wa.me`), interactive Web Chatbot REST API, and Job Board webhooks (LinkedIn, Wuzzuf, Bayt).
- **CV Parsing:** PyPDF & pdfplumber extraction from attached PDF resumes into `custom_raw_cv_text`.
- **Dynamic Sector AI Screening:** OpenRouter AI integration with tailored prompts for:
  - **Hospitality:** European language fluency (Russian, Italian, German, English), luxury guest empathy, 24/7 resort shifts.
  - **Real Estate:** Commercial leasing track record, minimum guaranteed vs turnover rent, fit-out CAPEX modeling, Egyptian retail market.
  - **Corporate & Finance:** Multi-subsidiary holding consolidation, EAS/IFRS accounting, CBE foreign currency regulations, ERP governance.
- **Form Enhancements:** Color-coded fit scores (Green ≥ 75%, Orange 50-74%, Red < 50%), 1-click WhatsApp chat, and automated WhatsApp interview scheduling.

---

## 🚀 Quick Installation on Frappe Bench

### 1. In Frappe Manager or Bench Shell:
```bash
# Go to your bench directory
cd /workspace/frappe-bench

# Get the app
bench get-app https://github.com/sharm-dreams-group/sharm_dreams_hr.git

# Install app on your site
bench --site [your-site-name] install-app sharm_dreams_hr

# Run database migrations to install custom fields fixtures
bench --site [your-site-name] migrate
```

### 2. Configure OpenRouter & WhatsApp in `site_config.json`:
Add your credentials to `sites/[your-site-name]/site_config.json`:
```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "whatsapp_access_token": "EAA...",
  "whatsapp_phone_number_id": "100987654321",
  "whatsapp_verify_token": "sharm_dreams_hr_secret_token_2026"
}
```

### 3. Restart Bench:
```bash
bench restart
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/method/sharm_dreams_hr.api.omnichannel.whatsapp_webhook` | `GET / POST` | Meta WhatsApp Cloud API Webhook |
| `/api/method/sharm_dreams_hr.api.omnichannel.web_chatbot_submit` | `POST` | Website Career Portal / Chatbot intake |
| `/api/method/sharm_dreams_hr.api.omnichannel.job_board_webhook` | `POST` | LinkedIn / Wuzzuf / Bayt webhook |
| `/api/method/sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant` | `POST` | Trigger AI evaluation for applicant |
| `/api/method/sharm_dreams_hr.api.omnichannel.send_whatsapp_interview_invite` | `POST` | Dispatches WhatsApp interview invitation |

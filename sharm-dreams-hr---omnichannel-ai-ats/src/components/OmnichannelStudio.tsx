import React, { useState } from 'react';
import { 
  MessageCircle, Globe, Briefcase, Send, CheckCircle2, 
  Terminal, ShieldCheck, ArrowRight, RefreshCw, Smartphone
} from 'lucide-react';
import { JobApplicant } from '../types';

interface OmnichannelStudioProps {
  onApplicantIngested: (newApplicant: JobApplicant) => void;
}

export const OmnichannelStudio: React.FC<OmnichannelStudioProps> = ({
  onApplicantIngested
}) => {
  const [activeChannel, setActiveChannel] = useState<'whatsapp' | 'chatbot' | 'jobboard'>('whatsapp');

  // WhatsApp form state
  const [waName, setWaName] = useState('Nourhan El-Shazly');
  const [waPhone, setWaPhone] = useState('+201066778899');
  const [waCompany, setWaCompany] = useState('Sharm Dreams for Touristic Investment');
  const [waSector, setWaSector] = useState<'Hospitality & Resort Ops' | 'Real Estate & Development' | 'Corporate & Finance'>('Hospitality & Resort Ops');
  const [waJobTitle, setWaJobTitle] = useState('Front Office & VIP Concierge Supervisor');
  const [waMessage, setWaMessage] = useState(
`Hello Sharm Dreams HR, I am applying for the VIP Concierge Supervisor role at Jaz Sharm Dreams Resort.
I have 6 years experience in luxury Sharm resorts (Stella Di Mare and Baron Resort).
Languages: Arabic (Native), Russian (Fluent C1 - 5 years dealing with Russian charter tourists), Italian (B2 Conversational), English (Fluent).
Available for immediate relocation to Sharm El Sheikh.`
  );

  const [loading, setLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<any>(null);
  const [webhookTokenStatus, setWebhookTokenStatus] = useState<string | null>(null);

  // Apply Presets
  const applyPreset = (preset: 'hospitality' | 'realestate' | 'finance') => {
    if (preset === 'hospitality') {
      setWaName('Nourhan El-Shazly');
      setWaPhone('+201066778899');
      setWaCompany('Sharm Dreams for Touristic Investment');
      setWaSector('Hospitality & Resort Ops');
      setWaJobTitle('VIP Concierge Supervisor (Jaz Sharm Dreams)');
      setWaMessage(
`Hello Sharm Dreams HR, I am applying for the VIP Concierge Supervisor role at Jaz Sharm Dreams Resort.
I have 6 years experience in luxury Sharm resorts (Stella Di Mare and Baron Resort).
Languages: Arabic (Native), Russian (Fluent C1 - 5 years dealing with Russian charter tourists), Italian (B2 Conversational), English (Fluent).
Available for immediate relocation to Sharm El Sheikh.`
      );
    } else if (preset === 'realestate') {
      setWaName('Karim Sherif Abdel-Wahab');
      setWaPhone('+201288990011');
      setWaCompany('Commercial & Real Estate Development (Il Mercato)');
      setWaSector('Real Estate & Development');
      setWaJobTitle('Commercial Leasing Specialist (Il Mercato Mall)');
      setWaMessage(
`Dear Sharm Dreams Recruitment,
Submitting application for Commercial Leasing Specialist at Il Mercato Shopping Center.
Background: 7 years managing tenant leases and retail negotiations in New Cairo and Alexandria.
Closed 35+ commercial agreements with regional F&B brands and Egyptian fashion houses.
Proficient in percentage rent models, minimum guarantees, and tenant fit-out coordination.`
      );
    } else {
      setWaName('Dina Mahmoud Soliman, ACCA');
      setWaPhone('+201199887766');
      setWaCompany('Corporate & Shared Services');
      setWaSector('Corporate & Finance');
      setWaJobTitle('Senior Treasury & Compliance Accountant');
      setWaMessage(
`To Sharm Dreams Group HR,
Applying for Senior Treasury Accountant at Cairo Holding Office.
Certifications: ACCA Member, B.Com Cairo University (English Section).
Experience: 8 years handling multi-entity cash flow, foreign currency CBE regulations, bank syndicate facilities, and Egyptian Tax Authority e-invoicing reconciliations.`
      );
    }
  };

  const handleSendWhatsAppWebhook = async () => {
    setLoading(true);
    setApiResponse(null);

    // Build payload matching Meta WhatsApp Cloud API incoming webhook structure
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WHATSAPP_BIZ_ACCOUNT_ID",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "201000000000",
                  phone_number_id: "SHARM_DREAMS_WA_ID"
                },
                contacts: [
                  {
                    profile: { name: waName },
                    wa_id: waPhone.replace(/\D/g, '')
                  }
                ],
                messages: [
                  {
                    from: waPhone.replace(/\D/g, ''),
                    id: `wamid.HBgM${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: waMessage },
                    type: "text"
                  }
                ]
              },
              field: "messages"
            }
          ]
        }
      ],
      // Enrichment fields passed through
      applicant_name: waName,
      phone_number: waPhone,
      company: waCompany,
      sector: waSector,
      job_title: waJobTitle,
      cv_text: waMessage
    };

    try {
      const res = await fetch('/api/omnichannel/whatsapp-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setApiResponse(data);
      if (data.applicant) {
        onApplicantIngested(data.applicant);
      }
    } catch (err: any) {
      setApiResponse({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestTokenVerification = async () => {
    setWebhookTokenStatus('Verifying token with /api/omnichannel/whatsapp-webhook...');
    try {
      const challengeCode = `CHALLENGE_${Math.floor(Math.random() * 999999)}`;
      const res = await fetch(`/api/omnichannel/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=sharm_dreams_hr_secret_token_2026&hub.challenge=${challengeCode}`);
      const text = await res.text();
      if (text === challengeCode) {
        setWebhookTokenStatus(`✅ Meta Webhook handshake verified! Challenge responded with: "${text}"`);
      } else {
        setWebhookTokenStatus(`❌ Verification failed: ${text}`);
      }
    } catch (e: any) {
      setWebhookTokenStatus(`❌ Verification error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <Smartphone className="w-4 h-4" />
              Omnichannel Candidate Ingestion Gateway
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Meta WhatsApp Cloud API & Webhook Simulator
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Test candidate ingestion via real Meta WhatsApp webhooks, Web Career Chatbot forms, and Job Board webhooks. All payloads populate Frappe HR's <code className="text-amber-300 font-mono">Job Applicant</code> DocType with automated PyPDF extraction and OpenRouter AI screening.
            </p>
          </div>

          <button
            onClick={handleTestTokenVerification}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 shrink-0 transition-colors shadow-sm"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify Meta Webhook Token
          </button>
        </div>

        {webhookTokenStatus && (
          <div className="mt-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono">
            {webhookTokenStatus}
          </div>
        )}
      </div>

      {/* Channel Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveChannel('whatsapp')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeChannel === 'whatsapp'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          Meta WhatsApp Cloud API (wa.me)
        </button>

        <button
          onClick={() => setActiveChannel('chatbot')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeChannel === 'chatbot'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Globe className="w-4 h-4" />
          Website Career Chatbot REST API
        </button>

        <button
          onClick={() => setActiveChannel('jobboard')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeChannel === 'jobboard'
              ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          LinkedIn / Wuzzuf / Bayt Webhook
        </button>
      </div>

      {/* Main Simulator Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: Ingestion Inputs */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-400" />
              Simulate WhatsApp Applicant Message
            </h3>

            {/* Presets */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 text-[11px]">Presets:</span>
              <button
                onClick={() => applyPreset('hospitality')}
                className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 hover:bg-slate-700 text-[11px]"
              >
                Hospitality VIP
              </button>
              <button
                onClick={() => applyPreset('realestate')}
                className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 hover:bg-slate-700 text-[11px]"
              >
                Il Mercato Leasing
              </button>
              <button
                onClick={() => applyPreset('finance')}
                className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 hover:bg-slate-700 text-[11px]"
              >
                Corporate Finance
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Candidate Full Name</label>
              <input
                type="text"
                value={waName}
                onChange={(e) => setWaName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:ring-1 focus:ring-amber-500 outline-none"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1 font-medium">WhatsApp Mobile (+20 Egypt)</label>
              <input
                type="text"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:ring-1 focus:ring-amber-500 outline-none"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1 font-medium">Target Subsidiary</label>
              <select
                value={waCompany}
                onChange={(e) => setWaCompany(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:ring-1 focus:ring-amber-500 outline-none"
              >
                <option value="Sharm Dreams for Touristic Investment">Sharm Dreams for Touristic Investment</option>
                <option value="Commercial & Real Estate Development (Il Mercato)">Commercial & Real Estate Development (Il Mercato)</option>
                <option value="Rowad Misr for Tourism Investment">Rowad Misr for Tourism Investment</option>
                <option value="Corporate & Shared Services">Corporate & Shared Services</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1 font-medium">Business Sector</label>
              <select
                value={waSector}
                onChange={(e) => setWaSector(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:ring-1 focus:ring-amber-500 outline-none"
              >
                <option value="Hospitality & Resort Ops">Hospitality & Resort Ops</option>
                <option value="Real Estate & Development">Real Estate & Development</option>
                <option value="Corporate & Finance">Corporate & Finance</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="text-slate-400 block mb-1 font-medium">Position Applied For</label>
              <input
                type="text"
                value={waJobTitle}
                onChange={(e) => setWaJobTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:ring-1 focus:ring-amber-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-slate-400 block mb-1 font-medium">
                Incoming WhatsApp Chat Message / CV Text
              </label>
              <textarea
                rows={5}
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-sans text-xs focus:ring-1 focus:ring-amber-500 outline-none leading-relaxed"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-slate-500 text-[11px]">
              Will trigger Frappe endpoint: <code>/api/omnichannel/whatsapp-webhook</code>
            </span>

            <button
              onClick={handleSendWhatsAppWebhook}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-emerald-950 transition-all disabled:opacity-50"
            >
              <Send className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Transmitting Webhook...' : 'Dispatch Ingestion Webhook'}
            </button>
          </div>
        </div>

        {/* Right Output: Live Webhook Inspection & Result */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-400" />
                Live Payload & Server Response
              </h3>
              <span className="text-[11px] text-emerald-400 font-mono">PORT 3000 REST</span>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
              {apiResponse ? (
                <pre>{JSON.stringify(apiResponse, null, 2)}</pre>
              ) : (
                <div className="text-slate-500 italic py-8 text-center">
                  Click "Dispatch Ingestion Webhook" to execute the Meta Cloud API webhook call and inspect the parsed response.
                </div>
              )}
            </div>
          </div>

          {apiResponse?.success && (
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="text-xs text-emerald-200">
                <b>Candidate Ingested:</b> {apiResponse.applicant_id} has been saved to Sharm Dreams HR database! Check the Recruiter ATS Desk to view the dossier.
              </div>
            </div>
          )}

          <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
            <div className="text-amber-400 font-semibold">Production Frappe Configuration:</div>
            <div>Webhook URL: <code className="text-slate-300">https://erp.sharmdreamsgroup.com/api/method/sharm_dreams_hr.api.omnichannel.whatsapp_webhook</code></div>
            <div>Verify Token: <code className="text-slate-300">sharm_dreams_hr_secret_token_2026</code></div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { 
  Terminal, Server, Key, Cpu, Copy, Check, 
  ExternalLink, CheckCircle2, AlertCircle, ShieldCheck
} from 'lucide-react';

export const DeploymentGuide: React.FC = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
          <Server className="w-4 h-4" />
          Production Frappe Bench & Docker Architecture
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white">
          Deployment & Bench Integration Runbook
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Step-by-step instructions for deploying <code className="text-amber-400 font-mono">sharm_dreams_hr</code> onto Frappe Manager (Docker bench) or a standalone Ubuntu / Debian Frappe v15/v16 server for Sharm Dreams Group.
        </p>
      </div>

      {/* Step by Step Execution Grid */}
      <div className="space-y-4">
        {/* Step 1 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">
                1
              </span>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Clone or Place Custom App into Frappe Bench
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(`cd /workspace/frappe-bench\nbench get-app https://github.com/sharm-dreams-group/sharm_dreams_hr.git`, 'step1')}
              className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
            >
              {copiedKey === 'step1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'step1' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 font-mono text-xs text-slate-200">
            <div><span className="text-slate-500"># Navigate to your bench root (Docker container or host)</span></div>
            <div className="text-amber-300">cd /workspace/frappe-bench</div>
            <div className="text-emerald-400 mt-1">bench get-app https://github.com/sharm-dreams-group/sharm_dreams_hr.git</div>
          </div>
          <p className="text-xs text-slate-400">
            Alternatively, extract the downloaded <code className="text-amber-300">sharm_dreams_hr_frappe_app.zip</code> into <code className="text-slate-300">apps/sharm_dreams_hr</code>.
          </p>
        </div>

        {/* Step 2 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">
                2
              </span>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Install App on Sharm Dreams Site & Migrate Fixtures
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(`bench --site hr.sharmdreamsgroup.com install-app sharm_dreams_hr\nbench --site hr.sharmdreamsgroup.com migrate`, 'step2')}
              className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
            >
              {copiedKey === 'step2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'step2' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 font-mono text-xs text-slate-200 space-y-1">
            <div className="text-emerald-400">bench --site hr.sharmdreamsgroup.com install-app sharm_dreams_hr</div>
            <div className="text-amber-300">bench --site hr.sharmdreamsgroup.com migrate</div>
          </div>
          <p className="text-xs text-slate-400">
            Running <code className="text-amber-300 font-mono">bench migrate</code> automatically reads <code className="text-slate-300 font-mono">fixtures/custom_field.json</code> and provisions the custom fields on <code className="text-slate-300 font-mono">Job Applicant</code>.
          </p>
        </div>

        {/* Step 3 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">
                3
              </span>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Configure Secrets in <code className="text-amber-400 font-mono">site_config.json</code>
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(`{\n  "openrouter_api_key": "sk-or-v1-YOUR_KEY",\n  "whatsapp_access_token": "EAA_YOUR_META_TOKEN",\n  "whatsapp_phone_number_id": "100987654321",\n  "whatsapp_verify_token": "sharm_dreams_hr_secret_token_2026"\n}`, 'step3')}
              className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
            >
              {copiedKey === 'step3' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'step3' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 font-mono text-xs text-slate-200">
            <pre className="text-amber-300">{`// File: sites/hr.sharmdreamsgroup.com/site_config.json
{
  "openrouter_api_key": "sk-or-v1-YOUR_OPENROUTER_KEY",
  "whatsapp_access_token": "EAAG...YOUR_META_TOKEN",
  "whatsapp_phone_number_id": "100987654321",
  "whatsapp_verify_token": "sharm_dreams_hr_secret_token_2026"
}`}</pre>
          </div>
          <p className="text-xs text-slate-400">
            Supports free models (<code className="text-slate-300">meta-llama/llama-3.3-70b-instruct:free</code>) and premium LLMs (<code className="text-slate-300">qwen/qwen-2.5-72b-instruct</code>, <code className="text-slate-300">anthropic/claude-3.5-sonnet</code>).
          </p>
        </div>

        {/* Step 4 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">
                4
              </span>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Configure Meta WhatsApp Cloud API Webhook
              </h3>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 text-xs text-slate-300 space-y-2">
            <div>
              1. Open <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-amber-400 underline">Meta Developer Portal</a> &rarr; WhatsApp &rarr; Configuration &rarr; Webhook Callback URL:
            </div>
            <div className="font-mono bg-slate-900 p-2 rounded border border-slate-800 text-emerald-400">
              https://hr.sharmdreamsgroup.com/api/method/sharm_dreams_hr.api.omnichannel.whatsapp_webhook
            </div>
            <div>
              2. Verify Token:
            </div>
            <div className="font-mono bg-slate-900 p-2 rounded border border-slate-800 text-amber-300">
              sharm_dreams_hr_secret_token_2026
            </div>
            <div>
              3. Webhook Subscription fields: check <code className="text-cyan-300 font-mono">messages</code>.
            </div>
          </div>
        </div>

        {/* Step 5 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center border border-amber-500/30">
                5
              </span>
              <h3 className="font-bold text-white text-sm sm:text-base">
                Verify via CLI Execution & Restart Bench
              </h3>
            </div>
            <button
              onClick={() => copyToClipboard(`bench --site hr.sharmdreamsgroup.com execute sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant --kwargs '{"applicant_name": "HR-APP-2026-00001"}'\nbench restart`, 'step5')}
              className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
            >
              {copiedKey === 'step5' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'step5' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 font-mono text-xs text-slate-200 space-y-1">
            <div className="text-slate-400"># Test evaluator directly from command line:</div>
            <div className="text-emerald-400">bench --site hr.sharmdreamsgroup.com execute sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant --kwargs '{'{"applicant_name": "HR-APP-2026-00001"}'}'</div>
            <div className="text-amber-300 mt-2">bench restart</div>
          </div>
        </div>
      </div>
    </div>
  );
};

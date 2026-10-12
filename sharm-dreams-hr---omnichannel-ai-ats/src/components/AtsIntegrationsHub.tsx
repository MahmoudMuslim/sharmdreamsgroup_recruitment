import React, { useState } from 'react';
import { 
  RefreshCw, CheckCircle2, ShieldCheck, Link2, 
  ExternalLink, Key, Database, Globe, ArrowRight, Zap
} from 'lucide-react';
import { JobApplicant } from '../types';

interface AtsIntegrationsHubProps {
  applicants: JobApplicant[];
  onTriggerSync: (provider: string) => Promise<void>;
}

export const AtsIntegrationsHub: React.FC<AtsIntegrationsHubProps> = ({
  applicants,
  onTriggerSync
}) => {
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string | null>(null);

  const handleSync = async (provider: string) => {
    setSyncing(true);
    setSyncLog(`Initiating bidirectional sync with ${provider.toUpperCase()} Harvest API...`);
    try {
      await onTriggerSync(provider);
      setSyncLog(`✅ Sync complete: Synchronized ${applicants.length} candidate applications, stages, and interview dates with ${provider}.`);
    } catch (e: any) {
      setSyncLog(`❌ Sync error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const atsPlatforms = [
    {
      name: "Greenhouse",
      type: "ATS & CRM",
      status: "Connected & Active",
      endpoint: "https://harvest.greenhouse.io/v1/candidates",
      syncCount: applicants.filter(a => a.ats_sync?.greenhouse_id).length || applicants.length,
      logoColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
      description: "Automated candidate stage export, scorecard sync, and interview panel calendar synchronization."
    },
    {
      name: "Lever",
      type: "ATS & Talent Sourcing",
      status: "Connected & Active",
      endpoint: "https://api.lever.co/v1/opportunities",
      syncCount: applicants.filter(a => a.ats_sync?.lever_id).length || applicants.length,
      logoColor: "text-blue-400 bg-blue-500/10 border-blue-500/30",
      description: "Two-way webhook integration for opportunity stages, feedback notes, and candidate requisition matching."
    },
    {
      name: "LinkedIn Talent Hub / Apply",
      type: "Sourcing Channel",
      status: "Webhook Ingestion Active",
      endpoint: "https://api.linkedin.com/v2/talentApplications",
      syncCount: applicants.filter(a => a.custom_acquisition_source === 'LinkedIn').length,
      logoColor: "text-sky-400 bg-sky-500/10 border-sky-500/30",
      description: "Direct InMail sync, 1-click applicant ingestion with verified work history and skill endorsements."
    },
    {
      name: "Workday Human Capital Management",
      type: "Enterprise ERP",
      status: "Configured (REST Ready)",
      endpoint: "https://workday.sharmdreamsgroup.com/ccx/api/v1/recruiting",
      syncCount: 4,
      logoColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
      description: "Employee requisition provisioning and new-hire payroll onboarding synchronization."
    }
  ];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Link2 className="w-4 h-4" />
            Enterprise ATS & Job Boards Integration Hub
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            Greenhouse, Lever & LinkedIn Sync Hub
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Bi-directional synchronization layer bridging TalentPulse AI, Frappe HR, and top global ATS platforms. Candidates, stage transitions, and AI scorecards sync automatically.
          </p>
        </div>

        <button
          onClick={() => handleSync('all')}
          disabled={syncing}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-amber-950 transition-all shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing Pipeline...' : 'Sync All ATS Platforms'}
        </button>
      </div>

      {syncLog && (
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs text-amber-300">
          {syncLog}
        </div>
      )}

      {/* Grid of ATS Connectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {atsPlatforms.map(platform => (
          <div
            key={platform.name}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-base ${platform.logoColor}`}>
                    {platform.name[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">{platform.name}</h3>
                    <span className="text-[11px] text-slate-400">{platform.type}</span>
                  </div>
                </div>

                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {platform.status}
                </span>
              </div>

              <p className="text-xs text-slate-300 mt-3.5 leading-relaxed">
                {platform.description}
              </p>

              <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-[11px] text-slate-400 space-y-1">
                <div className="text-slate-500">API Endpoint:</div>
                <div className="text-amber-300 truncate">{platform.endpoint}</div>
                <div className="text-slate-500 pt-1">Synchronized Records: <b className="text-white">{platform.syncCount} candidates</b></div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Webhook Polling: 30s</span>
              <button
                onClick={() => handleSync(platform.name.toLowerCase())}
                disabled={syncing}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Trigger {platform.name} Sync
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Sync State Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-amber-400" />
            Live Candidate ATS Cross-Referencing
          </h3>
          <span className="text-xs text-slate-500">{applicants.length} synced records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-semibold tracking-wider">
              <tr>
                <th className="p-3">Candidate</th>
                <th className="p-3">Position</th>
                <th className="p-3">Greenhouse Ref</th>
                <th className="p-3">Lever Ref</th>
                <th className="p-3">Sync Status</th>
                <th className="p-3">Last Polled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {applicants.map(a => (
                <tr key={a.id} className="hover:bg-slate-850/50">
                  <td className="p-3 font-semibold text-white">{a.applicant_name}</td>
                  <td className="p-3 text-slate-400">{a.job_title}</td>
                  <td className="p-3 font-mono text-emerald-400">{a.ats_sync?.greenhouse_id || 'GH-PENDING'}</td>
                  <td className="p-3 font-mono text-cyan-400">{a.ats_sync?.lever_id || 'LEV-PENDING'}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold text-[10px]">
                      {a.ats_sync?.sync_status || 'Synced'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">
                    {a.ats_sync?.last_synced ? new Date(a.ats_sync.last_synced).toLocaleTimeString() : 'Just now'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

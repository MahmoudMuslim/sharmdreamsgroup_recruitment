import React, { useState, useEffect } from 'react';
import { 
  JobApplicant, JobPosition, RecruiterRole, SupportedLanguage,
  PortalMode, SupabaseConfig, OpenRouterConfig 
} from './types';
import { RecruiterDesk } from './components/RecruiterDesk';
import { CandidateModal } from './components/CandidateModal';
import { SkillMatcher } from './components/SkillMatcher';
import { CandidatePortal } from './components/CandidatePortal';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { InterviewScheduler } from './components/InterviewScheduler';
import { AtsIntegrationsHub } from './components/AtsIntegrationsHub';
import { AiToolsSuite } from './components/AiToolsSuite';
import { CanditechAssessmentSuite } from './components/CanditechAssessmentSuite';
import { OmnichannelStudio } from './components/OmnichannelStudio';
import { CodeVault } from './components/CodeVault';
import { DeploymentGuide } from './components/DeploymentGuide';
import { JobsPage } from './components/JobsPage';
import { CloudIntegrationsModal } from './components/CloudIntegrationsModal';
import { TRANSLATIONS } from './utils/translations';
import { 
  Building, Sparkles, MessageCircle, Code2, 
  Terminal, ShieldCheck, RefreshCw, CheckCircle,
  ExternalLink, Layers, Award, BarChart3, Calendar,
  Link2, UserCheck, Lock, Globe, Users, Heart, Laptop,
  PanelLeftClose, PanelLeftOpen, Menu, X, ChevronRight,
  Database, Zap, Briefcase, Copy, Check
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<
    'desk' | 'matcher' | 'canditech' | 'portal' | 'analytics' | 'scheduler' | 'ats' | 'tools' | 'omnichannel' | 'code' | 'deploy'
  >('desk');

  const [applicants, setApplicants] = useState<JobApplicant[]>([]);
  const [jobs, setJobs] = useState<JobPosition[]>([]);
  const [selectedApplicant, setSelectedApplicant] = useState<JobApplicant | null>(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);

  // Mode: 'admin' (Recruiter ATS Workspace) vs 'jobs' (Public Careers Portal)
  const [portalMode, setPortalMode] = useState<PortalMode>('admin');

  // Cloud Integrations Modal state
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);
  const [schemaBannerDismissed, setSchemaBannerDismissed] = useState(false);

  const SUPABASE_SCHEMA_SQL = `-- SHARM DREAMS ATS - SUPABASE POSTGRESQL SCHEMA
CREATE TABLE IF NOT EXISTS public.jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  company TEXT NOT NULL,
  business_sector TEXT NOT NULL,
  location TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Full-time',
  salary_range TEXT,
  required_skills JSONB DEFAULT '[]'::jsonb,
  preferred_skills JSONB DEFAULT '[]'::jsonb,
  cultural_values JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  status TEXT DEFAULT 'Active',
  applicants_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.applicants (
  id TEXT PRIMARY KEY,
  applicant_name TEXT NOT NULL,
  email_address TEXT NOT NULL,
  phone_number TEXT,
  company TEXT NOT NULL,
  custom_business_sector TEXT NOT NULL,
  job_title TEXT NOT NULL,
  custom_acquisition_source TEXT DEFAULT 'Direct Career Portal',
  status TEXT DEFAULT 'Applied',
  custom_ai_score NUMERIC,
  skill_match_score NUMERIC,
  cultural_fit_score NUMERIC,
  soft_skills_score NUMERIC,
  radar_scores JSONB,
  matched_skills JSONB DEFAULT '[]'::jsonb,
  missing_skills JSONB DEFAULT '[]'::jsonb,
  custom_ai_summary TEXT,
  custom_ai_strengths TEXT,
  custom_ai_red_flags TEXT,
  custom_suggested_interview_questions TEXT,
  custom_raw_cv_text TEXT,
  custom_whatsapp_chat_id TEXT,
  interviews JSONB DEFAULT '[]'::jsonb,
  sentiment_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applicants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read jobs" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Allow authenticated insert jobs" ON public.jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated update jobs" ON public.jobs FOR UPDATE USING (true);

CREATE POLICY "Allow public read applicants" ON public.applicants FOR SELECT USING (true);
CREATE POLICY "Allow authenticated insert applicants" ON public.applicants FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated update applicants" ON public.applicants FOR UPDATE USING (true);
`;

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setCopiedSchema(true);
    showNotification("1-Click SQL Schema copied! Paste into Supabase SQL Editor and click Run.");
    setTimeout(() => setCopiedSchema(false), 3000);
  };

  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseConfig>(() => {
    try {
      const saved = localStorage.getItem('sharm_supabase_config');
      return saved ? JSON.parse(saved) : { url: '', anonKey: '', isConnected: false };
    } catch {
      return { url: '', anonKey: '', isConnected: false };
    }
  });

  const [openRouterConfig, setOpenRouterConfig] = useState<OpenRouterConfig>(() => {
    try {
      const saved = localStorage.getItem('sharm_openrouter_config');
      return saved ? JSON.parse(saved) : { apiKey: '', model: 'deepseek/deepseek-chat', isConnected: false };
    } catch {
      return { apiKey: '', model: 'deepseek/deepseek-chat', isConnected: false };
    }
  });

  const saveSupabaseConfig = (cfg: SupabaseConfig) => {
    setSupabaseConfig(cfg);
    try {
      localStorage.setItem('sharm_supabase_config', JSON.stringify(cfg));
    } catch (e) {
      console.warn(e);
    }
  };

  const saveOpenRouterConfig = (cfg: OpenRouterConfig) => {
    setOpenRouterConfig(cfg);
    try {
      localStorage.setItem('sharm_openrouter_config', JSON.stringify(cfg));
    } catch (e) {
      console.warn(e);
    }
  };

  // Side Panel state: Expanded (true) or Collapsed Icon-Rail (false)
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // RBAC & Language State
  const [activeRole, setActiveRole] = useState<RecruiterRole>('Head of Talent / Super Admin');
  const [language, setLanguage] = useState<SupportedLanguage>('en');

  const t = TRANSLATIONS[language];

  // Fetch initial data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [candRes, jobRes, configRes] = await Promise.allSettled([
        fetch('/api/candidates'),
        fetch('/api/jobs'),
        fetch('/api/integrations/config')
      ]);

      if (candRes.status === 'fulfilled') {
        const candData = await candRes.value.json();
        if (candData.success && candData.applicants) {
          setApplicants(candData.applicants);
        }
      }

      if (jobRes.status === 'fulfilled') {
        const jobData = await jobRes.value.json();
        if (jobData.success && jobData.jobs) {
          setJobs(jobData.jobs);
        }
      }

      if (configRes.status === 'fulfilled') {
        const cfgData = await configRes.value.json();
        if (cfgData.success) {
          if (cfgData.supabase?.configured) {
            setSupabaseConfig(prev => ({
              ...prev,
              isConnected: true,
              url: cfgData.supabase.url || prev.url || '',
              projectRef: cfgData.supabase.projectRef,
              tablesFound: cfgData.supabase.tablesFound,
              statusMessage: cfgData.supabase.message
            }));

            // If tables exist and have live records in Supabase, load them!
            if (cfgData.supabase.tablesFound && (cfgData.supabase.dbJobsCount > 0 || cfgData.supabase.dbApplicantsCount > 0)) {
              handleLoadRealDataFromSupabase();
            }
          }
          if (cfgData.openrouter?.configured) {
            setOpenRouterConfig(prev => ({
              ...prev,
              isConnected: true,
              model: prev.model || cfgData.openrouter.model,
              statusMessage: 'Universal AI Gateway Active'
            }));
          }
        }
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Pull Real Data from Supabase into App State
  const handleLoadRealDataFromSupabase = async () => {
    const res = await fetch('/api/integrations/supabase/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supabaseUrl: supabaseConfig.url,
        supabaseAnonKey: supabaseConfig.anonKey
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to pull data from Supabase');
    }
    if (data.jobs && data.jobs.length > 0) setJobs(data.jobs);
    if (data.applicants && data.applicants.length > 0) setApplicants(data.applicants);
    showNotification(`Live Data Loaded: ${data.jobs?.length || 0} jobs and ${data.applicants?.length || 0} candidates from Supabase!`);
  };

  // Sync / Seed current state to Supabase
  const handleSyncCurrentDataToSupabase = async () => {
    const res = await fetch('/api/integrations/supabase/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supabaseUrl: supabaseConfig.url,
        supabaseAnonKey: supabaseConfig.anonKey
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to sync data to Supabase');
    }
    showNotification(`Synchronized ${jobs.length} jobs and ${applicants.length} candidates to Supabase!`);
    await fetchData();
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleUpdateApplicant = (updated: JobApplicant) => {
    setApplicants(prev => prev.map(a => a.id === updated.id ? updated : a));
    setSelectedApplicant(updated);
    showNotification(`Applicant ${updated.applicant_name} updated successfully.`);
  };

  const handleApplicantIngested = (newApplicant: JobApplicant) => {
    setApplicants(prev => [newApplicant, ...prev]);
    showNotification(`New candidate ${newApplicant.applicant_name} ingested from WhatsApp!`);
  };

  const handleApplyFromPortal = async (candidateData: any) => {
    const res = await fetch('/api/omnichannel/web-chatbot-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidateData)
    });
    const data = await res.json();
    if (data.applicant) {
      setApplicants(prev => [data.applicant, ...prev]);
    } else {
      await fetchData();
    }
    showNotification(`Application submitted for ${candidateData.applicant_name}!`);
  };

  const handleSubmitSurvey = async (applicantId: string, rating: number, feedback: string) => {
    await fetch(`/api/candidates/${applicantId}/survey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, feedback })
    });
    await fetchData();
    showNotification("Candidate feedback survey recorded.");
  };

  const handleScheduleInterview = async (applicantId: string, interviewData: any) => {
    const res = await fetch(`/api/candidates/${applicantId}/schedule-interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interviewData)
    });
    const data = await res.json();
    if (data.applicant) {
      setApplicants(prev => prev.map(a => a.id === applicantId ? data.applicant : a));
    } else {
      await fetchData();
    }
    showNotification("Interview confirmed and WhatsApp invitation dispatched!");
  };

  const handleTriggerAtsSync = async (provider: string) => {
    await fetch('/api/ats/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    await fetchData();
    showNotification(`ATS Synchronized with ${provider.toUpperCase()}`);
  };

  const isRtl = language === 'ar';

  // Navigation Items Grouped Logically
  const navSections = [
    {
      group: 'Talent Acquisition',
      items: [
        { id: 'desk', label: t.recruiterDesk, icon: Layers, badge: String(applicants.length) },
        { id: 'matcher', label: t.skillMatching, icon: Award },
        { id: 'canditech', label: t.canditechAssessments, icon: Laptop, badge: 'New' },
      ]
    },
    {
      group: 'Candidate Journey',
      items: [
        { id: 'portal', label: t.portalCandidate, icon: UserCheck },
        { id: 'scheduler', label: t.interviewScheduler, icon: Calendar },
      ]
    },
    {
      group: 'Intelligence & ATS',
      items: [
        { id: 'analytics', label: t.analyticsDashboard, icon: BarChart3 },
        { id: 'ats', label: t.atsIntegrations, icon: Link2 },
        { id: 'tools', label: t.aiToolsSuite, icon: Sparkles },
      ]
    },
    {
      group: 'Architecture & Integrations',
      items: [
        { id: 'omnichannel', label: 'WhatsApp Gateway', icon: MessageCircle },
        { id: 'code', label: t.frappeVault, icon: Code2 },
        { id: 'deploy', label: 'Bench Runbook', icon: Terminal },
      ]
    }
  ];

  const currentTabObject = navSections.flatMap(s => s.items).find(i => i.id === activeTab);

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200 ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-950 border border-emerald-500/50 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-bottom-5 duration-200 text-xs sm:text-sm">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Security & Portal Mode Switcher Banner */}
      <div className="bg-slate-900 border-b border-slate-800/80 px-3 sm:px-6 py-2.5 text-xs text-slate-400 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto justify-between lg:justify-start">
          
          {/* Main Top Mode Switcher: Admin Center vs Public Careers */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 shadow-inner">
            <button
              onClick={() => setPortalMode('admin')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                portalMode === 'admin'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Recruiter Admin Hub</span>
            </button>

            <button
              onClick={() => setPortalMode('jobs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                portalMode === 'jobs'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Public Careers & Jobs</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-amber-300 font-bold">
                {jobs.length}
              </span>
            </button>
          </div>

          {/* Cloud Integrations (Supabase & OpenRouter) Trigger */}
          <button
            onClick={() => setShowCloudModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Configure Supabase Database and OpenRouter AI API credentials"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Data:</span>
            <span className={supabaseConfig.isConnected ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
              {supabaseConfig.isConnected ? 'Supabase Live' : 'Local In-Memory'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${supabaseConfig.isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          </button>

          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px] hidden xl:flex">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            {t.encryptionNotice}
          </span>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-4 w-full lg:w-auto justify-between lg:justify-end border-t lg:border-t-0 border-slate-800/60 pt-2 lg:pt-0">
          {/* RBAC Role Selector */}
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-400 hidden md:inline text-[11px]">{t.roleSwitch}:</span>
            <select
              value={activeRole}
              onChange={(e) => setActiveRole(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 text-[11px] text-amber-300 rounded-lg px-2 py-0.5 outline-none font-medium max-w-[170px] sm:max-w-none truncate"
            >
              <option value="Head of Talent / Super Admin">Head of Talent / Super Admin</option>
              <option value="Lead Recruiter">Lead Recruiter</option>
              <option value="Hiring Manager">Hiring Manager</option>
              <option value="Candidate Self-Service">Candidate Self-Service</option>
            </select>
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 text-[11px] text-slate-200 rounded-lg px-2 py-0.5 outline-none font-medium"
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main View Router: Public Careers vs Admin Recruiter Suite */}
      {portalMode === 'jobs' ? (
        <div className="flex-1 overflow-y-auto">
          <JobsPage
            jobs={jobs}
            applicants={applicants}
            onApply={handleApplyFromPortal}
            onSubmitSurvey={handleSubmitSurvey}
            onSwitchToAdmin={() => setPortalMode('admin')}
            onOpenCanditech={() => {
              setPortalMode('admin');
              setActiveTab('canditech');
            }}
          />
        </div>
      ) : (
        /* Main Layout Container with Side Panel + Content */
        <div className="flex-1 flex overflow-hidden">
        
        {/* DESKTOP SIDE PANEL */}
        <aside
          className={`hidden md:flex flex-col border-r border-slate-800/80 bg-slate-900/95 transition-all duration-300 shrink-0 select-none z-20 ${
            sidebarExpanded ? 'w-68' : 'w-20'
          }`}
        >
          {/* Sidebar Header & Brand */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 shadow-md shadow-amber-950/40 shrink-0">
                <Building className="w-5 h-5 font-bold" />
              </div>
              {sidebarExpanded && (
                <div className="min-w-0">
                  <div className="font-extrabold text-sm tracking-tight text-white truncate">
                    SHARM DREAMS
                  </div>
                  <div className="text-[10px] text-amber-400 font-medium truncate">
                    TalentPulse AI Suite
                  </div>
                </div>
              )}
            </div>

            {/* Toggle Collapse Button */}
            <button
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title={sidebarExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
            >
              {sidebarExpanded ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Sidebar Nav Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-5 scrollbar-thin">
            {navSections.map(section => (
              <div key={section.group} className="space-y-1">
                {sidebarExpanded && (
                  <div className="px-3 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    {section.group}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id as any)}
                        title={!sidebarExpanded ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                          isActive
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950 font-bold'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                        } ${!sidebarExpanded ? 'justify-center px-0' : ''}`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : 'group-hover:text-amber-400'}`} />
                        {sidebarExpanded && (
                          <span className="truncate flex-1 text-left">{item.label}</span>
                        )}
                        {sidebarExpanded && item.badge && (
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                            isActive ? 'bg-slate-950/30 text-slate-900' : 'bg-slate-800 text-amber-300'
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
            {sidebarExpanded ? (
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-1">
                <div className="text-amber-400 font-semibold flex items-center justify-between">
                  <span>Holding HRMS</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-slate-400 text-[10px]">
                  Connected to Frappe HR v15 / OpenRouter
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" title="System Operational" />
              </div>
            )}
          </div>
        </aside>

        {/* MOBILE DRAWER OVERLAY */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden bg-slate-950/80 backdrop-blur-sm flex">
            <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col h-full p-4 animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center font-bold text-slate-950">
                    <Building className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-sm text-white">TalentPulse AI</span>
                </div>
                <button
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-3 space-y-4">
                {navSections.map(section => (
                  <div key={section.group} className="space-y-1">
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-2">
                      {section.group}
                    </div>
                    {section.items.map(item => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveTab(item.id as any);
                            setMobileDrawerOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold ${
                            isActive
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="truncate flex-1 text-left">{item.label}</span>
                          {item.badge && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-amber-300">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileDrawerOpen(false)} />
          </div>
        )}

        {/* MAIN APPLICATION WORKSPACE */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          
          {/* Top Bar for View Header */}
          <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              {/* Mobile Drawer Trigger */}
              <button
                onClick={() => setMobileDrawerOpen(true)}
                className="md:hidden p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {currentTabObject?.label || 'Dashboard'}
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium hidden sm:inline">
                    Sharm Dreams Group
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  Jaz Sharm Dreams • Il Mercato Commercial • Fayrouz Resort • Corporate HQ
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCloudModal(true)}
                className="px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-colors bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 cursor-pointer"
                title="Configure Supabase Database and OpenRouter AI"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Cloud Data</span>
              </button>

              <button
                onClick={() => setPortalMode('jobs')}
                className="px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-colors bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 cursor-pointer"
                title="Open Public Careers Showcase"
              >
                <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Careers Portal</span>
              </button>

              <button
                onClick={() => setActiveTab('canditech')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === 'canditech'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Canditech</span>
              </button>
            </div>
          </header>

          {/* Workspace Body */}
          <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8 pb-24 md:pb-8">
            {activeTab === 'desk' && (
              <RecruiterDesk
                applicants={applicants}
                onSelectApplicant={setSelectedApplicant}
                onOpenOmnichannel={() => setActiveTab('omnichannel')}
                onRefresh={fetchData}
              />
            )}

            {activeTab === 'matcher' && (
              <SkillMatcher
                applicants={applicants}
                jobs={jobs}
                onSelectApplicant={setSelectedApplicant}
              />
            )}

            {activeTab === 'canditech' && (
              <CanditechAssessmentSuite
                applicants={applicants}
              />
            )}

            {activeTab === 'portal' && (
              <CandidatePortal
                jobs={jobs}
                applicants={applicants}
                onApply={handleApplyFromPortal}
                onSubmitSurvey={handleSubmitSurvey}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsDashboard
                applicants={applicants}
                jobs={jobs}
              />
            )}

            {activeTab === 'scheduler' && (
              <InterviewScheduler
                applicants={applicants}
                onScheduleInterview={handleScheduleInterview}
              />
            )}

            {activeTab === 'ats' && (
              <AtsIntegrationsHub
                applicants={applicants}
                onTriggerSync={handleTriggerAtsSync}
              />
            )}

            {activeTab === 'tools' && (
              <AiToolsSuite
                applicants={applicants}
                jobs={jobs}
              />
            )}

            {activeTab === 'omnichannel' && (
              <OmnichannelStudio
                onApplicantIngested={handleApplicantIngested}
              />
            )}

            {activeTab === 'code' && (
              <CodeVault />
            )}

            {activeTab === 'deploy' && (
              <DeploymentGuide />
            )}
          </main>

          {/* Footer */}
          <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-6 text-xs text-slate-500 hidden md:block">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-400">
                <span className="font-semibold text-slate-300">Sharm Dreams Group</span>
                <span>•</span>
                <span>TalentPulse AI Enterprise Suite</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Custom Frappe App <code className="text-amber-400/80 font-mono">sharm_dreams_hr</code> • AES-256 Encrypted
              </div>
            </div>
          </footer>

        </div>
      </div>
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/90 px-2 py-1.5 flex items-center justify-around shadow-2xl">
        <button
          onClick={() => setActiveTab('desk')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'desk' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span className="text-[10px]">Candidates</span>
        </button>

        <button
          onClick={() => setActiveTab('canditech')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all relative ${
            activeTab === 'canditech' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Laptop className="w-4 h-4" />
          <span className="text-[10px]">Canditech</span>
          <span className="absolute top-0 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
        </button>

        <button
          onClick={() => setActiveTab('matcher')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'matcher' ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Award className="w-4 h-4" />
          <span className="text-[10px]">AI Match</span>
        </button>

        <button
          onClick={() => setActiveTab('portal')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'portal' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span className="text-[10px]">Portal</span>
        </button>

        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-slate-400 hover:text-white transition-all"
        >
          <Menu className="w-4 h-4" />
          <span className="text-[10px]">More</span>
        </button>
      </nav>

      {/* Candidate Dossier Modal */}
      {selectedApplicant && (
        <CandidateModal
          applicant={selectedApplicant}
          onClose={() => setSelectedApplicant(null)}
          onUpdateApplicant={handleUpdateApplicant}
        />
      )}

      {/* Cloud Integrations Modal (Supabase & OpenRouter) */}
      <CloudIntegrationsModal
        isOpen={showCloudModal}
        onClose={() => setShowCloudModal(false)}
        supabaseConfig={supabaseConfig}
        onSaveSupabaseConfig={saveSupabaseConfig}
        openRouterConfig={openRouterConfig}
        onSaveOpenRouterConfig={saveOpenRouterConfig}
        onLoadRealDataFromSupabase={handleLoadRealDataFromSupabase}
        onSyncCurrentDataToSupabase={handleSyncCurrentDataToSupabase}
        currentJobsCount={jobs.length}
        currentApplicantsCount={applicants.length}
      />

    </div>
  );
}

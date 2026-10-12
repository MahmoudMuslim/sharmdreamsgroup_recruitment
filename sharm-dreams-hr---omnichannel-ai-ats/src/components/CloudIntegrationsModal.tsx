import React, { useState } from 'react';
import { 
  Database, Sparkles, CheckCircle2, AlertCircle, RefreshCw, 
  Copy, Check, ExternalLink, Key, Zap, Shield, ArrowRight,
  Server, HardDrive, Terminal, X
} from 'lucide-react';
import { SupabaseConfig, OpenRouterConfig, JobPosition, JobApplicant } from '../types';

interface CloudIntegrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  supabaseConfig: SupabaseConfig;
  onSaveSupabaseConfig: (config: SupabaseConfig) => void;
  openRouterConfig: OpenRouterConfig;
  onSaveOpenRouterConfig: (config: OpenRouterConfig) => void;
  onLoadRealDataFromSupabase: () => Promise<void>;
  onSyncCurrentDataToSupabase: () => Promise<void>;
  currentJobsCount: number;
  currentApplicantsCount: number;
}

export const CloudIntegrationsModal: React.FC<CloudIntegrationsModalProps> = ({
  isOpen,
  onClose,
  supabaseConfig,
  onSaveSupabaseConfig,
  openRouterConfig,
  onSaveOpenRouterConfig,
  onLoadRealDataFromSupabase,
  onSyncCurrentDataToSupabase,
  currentJobsCount,
  currentApplicantsCount
}) => {
  const [activeTab, setActiveTab] = useState<'supabase' | 'openrouter' | 'sql'>('supabase');

  // Supabase local draft
  const [supabaseUrl, setSupabaseUrl] = useState(supabaseConfig.url || '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(supabaseConfig.anonKey || '');
  const [supabaseTesting, setSupabaseTesting] = useState(false);
  const [supabaseTestResult, setSupabaseTestResult] = useState<{
    success: boolean;
    message: string;
    tablesFound?: boolean;
    jobsCount?: number;
    applicantsCount?: number;
  } | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // OpenRouter local draft
  const [openRouterKey, setOpenRouterKey] = useState(openRouterConfig.apiKey || '');
  const [openRouterModel, setOpenRouterModel] = useState(openRouterConfig.model || 'deepseek/deepseek-chat');
  const [openRouterTesting, setOpenRouterTesting] = useState(false);
  const [openRouterTestResult, setOpenRouterTestResult] = useState<{
    success: boolean;
    message: string;
    latency_ms?: number;
    response?: string;
  } | null>(null);

  // SQL schema copy state
  const [copiedSql, setCopiedSql] = useState(false);

  if (!isOpen) return null;

  const testSupabase = async () => {
    setSupabaseTesting(true);
    setSupabaseTestResult(null);
    try {
      const res = await fetch('/api/integrations/supabase/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabaseUrl: supabaseUrl.trim(),
          supabaseAnonKey: supabaseAnonKey.trim()
        })
      });
      const data = await res.json();
      setSupabaseTestResult({
        success: data.success,
        message: data.message || data.error || 'Connection evaluated.',
        tablesFound: data.tablesFound,
        jobsCount: data.jobsCount,
        applicantsCount: data.applicantsCount
      });
      if (data.success) {
        onSaveSupabaseConfig({
          url: supabaseUrl.trim(),
          anonKey: supabaseAnonKey.trim(),
          isConnected: true,
          statusMessage: data.message,
          lastSynced: new Date().toISOString(),
          recordCounts: {
            jobs: data.jobsCount || 0,
            applicants: data.applicantsCount || 0
          }
        });
      }
    } catch (err: any) {
      setSupabaseTestResult({
        success: false,
        message: err.message || 'Network request failed when contacting Supabase endpoint.'
      });
    } finally {
      setSupabaseTesting(false);
    }
  };

  const handlePullRealData = async () => {
    setIsPulling(true);
    setSyncStatusMsg(null);
    try {
      await onLoadRealDataFromSupabase();
      setSyncStatusMsg("Successfully pulled and populated real data from your Supabase database!");
    } catch (err: any) {
      setSyncStatusMsg(`Failed to pull data: ${err.message}`);
    } finally {
      setIsPulling(false);
    }
  };

  const handleSyncToSupabase = async () => {
    setIsSyncing(true);
    setSyncStatusMsg(null);
    try {
      await onSyncCurrentDataToSupabase();
      setSyncStatusMsg("Successfully synchronized and seeded all positions and candidates to Supabase!");
    } catch (err: any) {
      setSyncStatusMsg(`Failed to seed data: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const testOpenRouter = async () => {
    setOpenRouterTesting(true);
    setOpenRouterTestResult(null);
    try {
      const res = await fetch('/api/integrations/openrouter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: openRouterKey.trim(),
          model: openRouterModel
        })
      });
      const data = await res.json();
      setOpenRouterTestResult({
        success: data.success,
        message: data.message || data.error,
        latency_ms: data.latency_ms,
        response: data.response
      });
      if (data.success) {
        onSaveOpenRouterConfig({
          apiKey: openRouterKey.trim(),
          model: openRouterModel,
          isConnected: true,
          statusMessage: `Active · Latency: ${data.latency_ms}ms`,
          lastTested: new Date().toISOString()
        });
      }
    } catch (err: any) {
      setOpenRouterTestResult({
        success: false,
        message: err.message || 'Error connecting to OpenRouter API.'
      });
    } finally {
      setOpenRouterTesting(false);
    }
  };

  const sqlSchemaText = `-- ==========================================
-- SHARM DREAMS ATS - SUPABASE POSTGRESQL SCHEMA
-- Paste this script into Supabase SQL Editor
-- ==========================================

-- 1. Jobs Table
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

-- 2. Applicants Table
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

-- 3. Enable RLS and permissive read policies for App
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
    navigator.clipboard.writeText(sqlSchemaText);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Cloud Integrations & Real Data Hub
              </h2>
              <p className="text-xs text-slate-400">
                Connect live Supabase Postgres database and OpenRouter LLM API key
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 gap-2">
          <button
            onClick={() => setActiveTab('supabase')}
            className={`py-3.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'supabase'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            Supabase Database
            {supabaseConfig.isConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('openrouter')}
            className={`py-3.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'openrouter'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            OpenRouter AI Key
            {openRouterConfig.isConnected && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`py-3.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'sql'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            Supabase SQL Schema
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* TAB 1: SUPABASE */}
          {activeTab === 'supabase' && (
            <div className="space-y-5">
              <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-2xl p-4 flex items-start gap-3">
                <Database className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <p className="font-semibold text-emerald-300">
                    Direct Supabase PostgreSQL Integration
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    Enter your Supabase project credentials to load real positions and applicants into Sharm Dreams ATS. You can also sync current memory records to populate your Supabase database in one click.
                  </p>
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Supabase Project URL
                  </label>
                  <input
                    type="url"
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                    placeholder="https://xyzcompany.supabase.co"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Found in your Supabase Dashboard under Project Settings &gt; API
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Supabase Anon / Public Key (or Service Role Key)
                  </label>
                  <input
                    type="password"
                    value={supabaseAnonKey}
                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={testSupabase}
                  disabled={supabaseTesting || !supabaseUrl || !supabaseAnonKey}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  {supabaseTesting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {supabaseTesting ? 'Testing Connection...' : 'Test Supabase Connection'}
                </button>

                <button
                  onClick={handlePullRealData}
                  disabled={isPulling}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isPulling ? 'animate-spin' : ''}`} />
                  {isPulling ? 'Pulling Data...' : 'Pull Real Data from Supabase'}
                </button>

                <button
                  onClick={handleSyncToSupabase}
                  disabled={isSyncing}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-300 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <HardDrive className={`w-4 h-4 ${isSyncing ? 'animate-pulse' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync Current ATS Data to Supabase'}
                </button>
              </div>

              {/* Status & Test Results */}
              {supabaseTestResult && (
                <div className={`p-4 rounded-2xl border text-xs ${
                  supabaseTestResult.success 
                    ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-300' 
                    : 'bg-rose-950/30 border-rose-900/60 text-rose-300'
                }`}>
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    {supabaseTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {supabaseTestResult.success ? 'Supabase Connected Successfully' : 'Connection Check Failed'}
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {supabaseTestResult.message}
                  </p>

                  {/* If connected but tables not created yet */}
                  {supabaseTestResult.tablesFound === false && (
                    <div className="mt-3 p-3 bg-slate-900/90 border border-amber-500/30 rounded-xl space-y-2">
                      <p className="text-amber-300 font-semibold flex items-center gap-1.5">
                        <Terminal className="w-4 h-4 text-amber-400" />
                        Next Step: Create 'jobs' & 'applicants' tables in Supabase SQL Editor
                      </p>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        Copy the schema below, paste into Supabase SQL Editor, and click "Run". Then click "Sync Current ATS Data to Supabase" to seed all live records!
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={copySqlToClipboard}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedSql ? 'Copied SQL Script!' : '1-Click Copy SQL'}
                        </button>
                        <a
                          href={`https://supabase.com/dashboard/project/lbxdeceropsxwohnzinl/sql/new`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Supabase SQL Editor
                        </a>
                        <button
                          type="button"
                          onClick={handleSyncToSupabase}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <HardDrive className="w-3.5 h-3.5" />
                          Sync & Populate Database
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {syncStatusMsg && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-amber-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {syncStatusMsg}
                </div>
              )}

              {/* Current Local Snapshot */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">Current App State:</span>
                <div className="flex items-center gap-4 text-slate-200">
                  <span><strong>{currentJobsCount}</strong> Active Job Positions</span>
                  <span className="text-slate-600">·</span>
                  <span><strong>{currentApplicantsCount}</strong> Candidates Tracked</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OPENROUTER */}
          {activeTab === 'openrouter' && (
            <div className="space-y-5">
              <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-4 flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <p className="font-semibold text-amber-300">
                    OpenRouter Universal AI Gateway
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    Connect an OpenRouter API key to route resume screening, candidate skill scoring, and question generation through modern models such as DeepSeek V3, Claude 3.5 Sonnet, Llama 3.3, or Gemini.
                  </p>
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    OpenRouter API Key
                  </label>
                  <input
                    type="password"
                    value={openRouterKey}
                    onChange={(e) => setOpenRouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Get an API key from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-amber-400 underline">openrouter.ai/keys</a>
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Target AI Model
                  </label>
                  <select
                    value={openRouterModel}
                    onChange={(e) => setOpenRouterModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-amber-500 transition-colors"
                  >
                    <option value="deepseek/deepseek-chat">deepseek/deepseek-chat (DeepSeek V3 - High speed & accuracy)</option>
                    <option value="anthropic/claude-3.5-sonnet">anthropic/claude-3.5-sonnet (Claude 3.5 Sonnet - Top reasoning)</option>
                    <option value="meta-llama/llama-3.3-70b-instruct">meta-llama/llama-3.3-70b-instruct (Llama 3.3 70B)</option>
                    <option value="google/gemini-2.0-flash">google/gemini-2.0-flash (Gemini 2.0 Flash via OpenRouter)</option>
                    <option value="openai/gpt-4o-mini">openai/gpt-4o-mini (GPT-4o Mini)</option>
                  </select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={testOpenRouter}
                  disabled={openRouterTesting || !openRouterKey}
                  className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer"
                >
                  {openRouterTesting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  {openRouterTesting ? 'Testing Latency...' : 'Test OpenRouter Key'}
                </button>

                <button
                  onClick={() => {
                    onSaveOpenRouterConfig({
                      apiKey: openRouterKey.trim(),
                      model: openRouterModel,
                      isConnected: true,
                      statusMessage: `Configured · ${openRouterModel}`,
                      lastTested: new Date().toISOString()
                    });
                    setOpenRouterTestResult({
                      success: true,
                      message: `Saved model configuration: ${openRouterModel}`
                    });
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Save Settings
                </button>
              </div>

              {/* Test Results */}
              {openRouterTestResult && (
                <div className={`p-4 rounded-2xl border text-xs ${
                  openRouterTestResult.success 
                    ? 'bg-amber-950/30 border-amber-900/60 text-amber-300' 
                    : 'bg-rose-950/30 border-rose-900/60 text-rose-300'
                }`}>
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      {openRouterTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                      {openRouterTestResult.success ? 'OpenRouter Operational' : 'OpenRouter Error'}
                    </span>
                    {openRouterTestResult.latency_ms && (
                      <span className="text-[11px] text-slate-400 font-mono">
                        {openRouterTestResult.latency_ms}ms latency
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {openRouterTestResult.message}
                  </p>
                  {openRouterTestResult.response && (
                    <div className="mt-2 p-2.5 rounded-xl bg-slate-950/80 font-mono text-[11px] text-slate-300">
                      &quot;{openRouterTestResult.response}&quot;
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SQL SCHEMA */}
          {activeTab === 'sql' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Run this SQL in your Supabase project&apos;s SQL Editor to instantiate the tables and Row Level Security:
                </p>
                <button
                  onClick={copySqlToClipboard}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSql ? 'Copied to Clipboard!' : 'Copy SQL Script'}
                </button>
              </div>

              <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono overflow-x-auto max-h-80 leading-relaxed">
                {sqlSchemaText}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Encrypted local storage · No secrets transmitted to third parties</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { JobApplicant } from '../types';
import { 
  Building2, Briefcase, Phone, MessageCircle, 
  Sparkles, Search, Filter, Plus, ChevronRight, CheckCircle2,
  Calendar, Layers, ShieldCheck
} from 'lucide-react';

interface RecruiterDeskProps {
  applicants: JobApplicant[];
  onSelectApplicant: (applicant: JobApplicant) => void;
  onOpenOmnichannel: () => void;
  onRefresh: () => void;
}

export const RecruiterDesk: React.FC<RecruiterDeskProps> = ({
  applicants,
  onSelectApplicant,
  onOpenOmnichannel,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubsidiary, setSelectedSubsidiary] = useState<string>('All');
  const [selectedSector, setSelectedSector] = useState<string>('All');
  const [selectedSource, setSelectedSource] = useState<string>('All');

  // Filter applicants
  const filteredApplicants = applicants.filter(app => {
    const matchesSearch = 
      app.applicant_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.job_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.email_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.custom_raw_cv_text && app.custom_raw_cv_text.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesSubsidiary = selectedSubsidiary === 'All' || app.company === selectedSubsidiary;
    const matchesSector = selectedSector === 'All' || app.custom_business_sector === selectedSector;
    const matchesSource = selectedSource === 'All' || app.custom_acquisition_source === selectedSource;

    return matchesSearch && matchesSubsidiary && matchesSector && matchesSource;
  });

  // Calculate stats
  const totalCount = applicants.length;
  const screenedCount = applicants.filter(a => a.custom_ai_score !== null).length;
  const highFitCount = applicants.filter(a => (a.custom_ai_score || 0) >= 75).length;
  const avgScore = screenedCount > 0 
    ? Math.round(applicants.reduce((acc, a) => acc + (a.custom_ai_score || 0), 0) / screenedCount) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Top Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Total Applicants</span>
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white mt-2">
            {totalCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Across 4 Group Subsidiaries
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>AI Screened</span>
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-cyan-400 mt-2">
            {screenedCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {Math.round((screenedCount / (totalCount || 1)) * 100)}% automated coverage
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>High Fit Candidates</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-2">
            {highFitCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            AI Score ≥ 75% Recommended
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Average Fit Score</span>
            <ShieldCheck className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-400 mt-2">
            {avgScore}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Sector-weighted evaluation
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3 justify-between">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search candidate name, role, skill..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9.5 pr-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <button
              onClick={onOpenOmnichannel}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Simulate Ingestion
            </button>
            <button
              onClick={onRefresh}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filter Pills with Smooth Horizontal Swiping on Mobile */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80 text-xs overflow-x-auto no-scrollbar py-1">
          <span className="text-slate-400 flex items-center gap-1 shrink-0 font-medium mr-1">
            <Filter className="w-3.5 h-3.5" />
            Subsidiary:
          </span>
          {['All', 'Sharm Dreams for Touristic Investment', 'Commercial & Real Estate Development (Il Mercato)', 'Rowad Misr for Tourism Investment', 'Corporate & Shared Services'].map(sub => (
            <button
              key={sub}
              onClick={() => setSelectedSubsidiary(sub)}
              className={`px-2.5 py-1 rounded-lg text-xs transition-all shrink-0 whitespace-nowrap ${
                selectedSubsidiary === sub
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {sub === 'Commercial & Real Estate Development (Il Mercato)' ? 'Il Mercato / Real Estate' : sub.replace(' for Touristic Investment', '').replace(' for Tourism Investment', '')}
            </button>
          ))}
        </div>

        {/* Sector and Source Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1 text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>Sector:</span>
              <select
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 outline-none text-xs"
              >
                <option value="All">All Sectors</option>
                <option value="Hospitality & Resort Ops">Hospitality & Resort Ops</option>
                <option value="Real Estate & Development">Real Estate & Development</option>
                <option value="Corporate & Finance">Corporate & Finance</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span>Channel:</span>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 outline-none text-xs"
              >
                <option value="All">All Channels</option>
                <option value="WhatsApp Chatbot">WhatsApp Chatbot</option>
                <option value="LinkedIn">LinkedIn</option>
                <option value="Wuzzuf/Bayt">Wuzzuf / Bayt</option>
                <option value="Direct Career Portal">Direct Career Portal</option>
              </select>
            </div>
          </div>

          <span className="text-slate-500 text-[11px] sm:text-xs">
            Showing {filteredApplicants.length} of {applicants.length} candidates
          </span>
        </div>
      </div>

      {/* Candidate Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredApplicants.map(applicant => {
          const score = applicant.custom_ai_score;
          const scoreBadgeClass = score === null
            ? 'bg-slate-800 text-slate-400 border-slate-700'
            : score >= 75
              ? 'bg-emerald-950/70 text-emerald-400 border-emerald-500/40 shadow-emerald-950/50'
              : score >= 50
                ? 'bg-amber-950/70 text-amber-400 border-amber-500/40 shadow-amber-950/50'
                : 'bg-rose-950/70 text-rose-400 border-rose-500/40 shadow-rose-950/50';

          return (
            <div
              key={applicant.id}
              onClick={() => onSelectApplicant(applicant)}
              className="group bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 cursor-pointer transition-all duration-200 shadow-md hover:shadow-xl relative flex flex-col justify-between"
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                      {applicant.applicant_name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base group-hover:text-amber-300 transition-colors">
                        {applicant.applicant_name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-amber-400/90 font-medium mt-0.5">
                        <Briefcase className="w-3.5 h-3.5" />
                        {applicant.job_title}
                      </div>
                    </div>
                  </div>

                  {/* AI Fit Score Pill */}
                  <div className={`px-2.5 py-1 rounded-xl text-xs font-bold border flex items-center gap-1.5 shadow-sm ${scoreBadgeClass}`}>
                    <Sparkles className="w-3.5 h-3.5" />
                    {score !== null ? `${score}% Fit` : 'Unscreened'}
                  </div>
                </div>

                {/* Subsidiary & Sector */}
                <div className="mt-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{applicant.company}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[11px] text-cyan-300">
                      {applicant.custom_business_sector}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[11px] text-slate-300 flex items-center gap-1">
                      {applicant.custom_acquisition_source === 'WhatsApp Chatbot' ? (
                        <MessageCircle className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      )}
                      {applicant.custom_acquisition_source}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-950 text-slate-400 font-mono">
                      {applicant.status}
                    </span>
                  </div>
                </div>

                {/* AI Executive Summary Snippet */}
                {applicant.custom_ai_summary && (
                  <p className="mt-3 text-xs text-slate-400 line-clamp-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 leading-relaxed">
                    {applicant.custom_ai_summary}
                  </p>
                )}
              </div>

              {/* Card Footer */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1 font-mono text-[11px]">
                  <Phone className="w-3 h-3 text-slate-500" />
                  {applicant.phone_number}
                </span>

                <div className="flex items-center gap-1 text-amber-400 font-medium group-hover:translate-x-1 transition-transform">
                  <span>Open Dossier</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          );
        })}

        {filteredApplicants.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <Filter className="w-8 h-8 text-slate-600 mx-auto" />
            <h4 className="text-base font-bold text-slate-300">No candidates match your current filter</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Try adjusting your search criteria, subsidiary selection, or ingest a new candidate via WhatsApp simulator.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

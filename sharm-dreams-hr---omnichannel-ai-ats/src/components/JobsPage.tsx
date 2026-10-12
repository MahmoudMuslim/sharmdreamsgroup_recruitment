import React, { useState } from 'react';
import { 
  JobPosition, JobApplicant, SupportedLanguage 
} from '../types';
import { 
  Briefcase, MapPin, Building2, Search, Filter, 
  Send, Sparkles, CheckCircle2, Calendar, Clock, 
  MessageCircle, Star, ThumbsUp, ArrowRight, UserCheck,
  ChevronRight, Bot, HelpCircle, ShieldCheck, X,
  ExternalLink, Layers, Award, Laptop, Check, AlertCircle,
  FileText, Phone, Mail, User, DollarSign, Compass
} from 'lucide-react';

interface JobsPageProps {
  jobs: JobPosition[];
  applicants: JobApplicant[];
  onApply: (candidateData: any) => Promise<void>;
  onSubmitSurvey: (applicantId: string, rating: number, feedback: string) => Promise<void>;
  onSwitchToAdmin: () => void;
  onOpenCanditech?: () => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({
  jobs,
  applicants,
  onApply,
  onSubmitSurvey,
  onSwitchToAdmin,
  onOpenCanditech
}) => {
  const [activeTab, setActiveTab] = useState<'open_jobs' | 'track_status' | 'career_bot'>('open_jobs');
  
  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Job Detail & Apply Modal
  const [selectedJob, setSelectedJob] = useState<JobPosition | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyName, setApplyName] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyPhone, setApplyPhone] = useState('+2010');
  const [applyCvText, setApplyCvText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applySuccessCode, setApplySuccessCode] = useState<string | null>(null);

  // Application Tracking
  const [trackQuery, setTrackQuery] = useState('');
  const [trackedApplicant, setTrackedApplicant] = useState<JobApplicant | null>(null);
  const [trackSearched, setTrackSearched] = useState(false);

  // Survey inside tracking
  const [surveyRating, setSurveyRating] = useState(5);
  const [surveyFeedback, setSurveyFeedback] = useState('');
  const [surveySubmitted, setSurveySubmitted] = useState(false);

  // AI Career Assistant Chatbot
  const [botMessages, setBotMessages] = useState<Array<{ sender: 'bot' | 'user'; text: string; time: string }>>([
    {
      sender: 'bot',
      text: "Welcome to Sharm Dreams Group Careers! I am your 24/7 AI Recruitment Guide. Ask me anything about our open positions in South Sinai & Cairo, executive housing, compensation, or interview stages.",
      time: "Just now"
    }
  ]);
  const [botInput, setBotInput] = useState('');
  const [botTyping, setBotTyping] = useState(false);

  // Filtering Logic
  const filteredJobs = jobs.filter(job => {
    const matchesQuery = 
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.required_skills.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesSector = sectorFilter === 'all' || job.business_sector === sectorFilter;
    const matchesLocation = locationFilter === 'all' || job.location.toLowerCase().includes(locationFilter.toLowerCase());
    const matchesType = typeFilter === 'all' || job.type === typeFilter;

    return matchesQuery && matchesSector && matchesLocation && matchesType;
  });

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyName || !applyEmail || !selectedJob) return;
    setIsSubmitting(true);
    try {
      const generatedId = `HR-APP-2026-${Math.floor(10100 + Math.random() * 900)}`;
      await onApply({
        applicant_name: applyName,
        email_address: applyEmail,
        phone_number: applyPhone,
        company: selectedJob.company,
        custom_business_sector: selectedJob.business_sector,
        job_title: selectedJob.title,
        custom_raw_cv_text: applyCvText || `Applicant applied for ${selectedJob.title}`
      });
      setApplySuccessCode(generatedId);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTrackLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setTrackSearched(true);
    const q = trackQuery.trim().toLowerCase();
    if (!q) {
      setTrackedApplicant(null);
      return;
    }
    const match = applicants.find(a => 
      a.id.toLowerCase() === q ||
      a.email_address.toLowerCase() === q ||
      a.phone_number.replace(/\D/g, '').includes(q.replace(/\D/g, ''))
    );
    setTrackedApplicant(match || null);
  };

  const handleSendBotMessage = (preset?: string) => {
    const q = preset || botInput;
    if (!q.trim()) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setBotMessages(prev => [...prev, { sender: 'user', text: q, time }]);
    setBotInput('');
    setBotTyping(true);

    setTimeout(() => {
      let reply = "Thank you for asking! Sharm Dreams Group prioritizes leadership excellence, staff well-being, and hospitality prestige. Our hiring committee reviews applications within 48 hours.";
      const low = q.toLowerCase();

      if (low.includes('housing') || low.includes('accommodation') || low.includes('sharm')) {
        reply = "For all positions based in Sharm El Sheikh (Jaz Sharm Dreams Resort, Fayrouz Resort), Sharm Dreams Group provides furnished resort staff residences, 3 daily buffet meals, medical coverage, return Cairo flights, and private beach recreational access.";
      } else if (low.includes('interview') || low.includes('stages') || low.includes('process')) {
        reply = "Our hiring process features 3 stages: 1) AI Resume Screening and multilingual evaluation, 2) Canditech Job Simulation (20-min practical scenario), and 3) Final panel interview with the Department Director and Group HR.";
      } else if (low.includes('language') || low.includes('russian') || low.includes('italian')) {
        reply = "For resort guest operations in Sharm El Sheikh, Russian and Italian proficiency qualifies candidates for generous monthly language allowances in addition to base salary.";
      } else if (low.includes('salary') || low.includes('pay') || low.includes('bonus')) {
        reply = "We offer competitive market compensation packages benchmarked against leading multinational hotel chains and top real estate developers, with annual performance bonuses and Eid gratuities.";
      }

      setBotMessages(prev => [...prev, {
        sender: 'bot',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setBotTyping(false);
    }, 550);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Careers Brand Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 text-xs text-amber-400 font-semibold uppercase tracking-wider mb-1">
            <Building2 className="w-4 h-4" />
            <span>Sharm Dreams Group · Careers & Opportunities</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Explore Open Positions & Build Your Legacy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
            Premier hospitality, commercial real estate development, and executive group operations across the Red Sea and Cairo.
          </p>
        </div>

        {/* Mode Switcher to Recruiter Admin */}
        <button
          onClick={onSwitchToAdmin}
          className="px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-lg"
        >
          <Layers className="w-4 h-4 text-amber-400" />
          <span>Switch to Recruiter Admin</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>

      {/* Hero Showcase Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 space-y-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Building2 className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Luxury Resort Operations</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Jaz Sharm Dreams & Fayrouz Resort offering 800+ keys, world-class diving, and 5-star hospitality in Naama Bay.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 space-y-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Compass className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Il Mercato Shopping Center</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Landmark 65,000 sqm open-air pedestrian commercial retail boulevard, premier dining, and international luxury brands.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 space-y-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Award className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Holding Corporate Services</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Group executive headquarters in Mohandessin & New Cairo managing capital treasury, legal, and multi-entity governance.
          </p>
        </div>
      </div>

      {/* Main Navigation Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab('open_jobs')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'open_jobs'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Open Positions ({jobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('track_status')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'track_status'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Track Application Status</span>
          </button>

          <button
            onClick={() => setActiveTab('career_bot')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'career_bot'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>AI Career Guide</span>
          </button>
        </div>

        <div className="text-xs text-slate-400 hidden sm:flex items-center gap-2 px-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Equal Opportunity Employer · Bias-Free AI Screening</span>
        </div>
      </div>

      {/* VIEW 1: OPEN POSITIONS */}
      {activeTab === 'open_jobs' && (
        <div className="space-y-6">
          {/* Search & Filter Bar */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800/80 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by job title, department, or required skill (e.g. Russian, VIP, Leasing, Treasury)..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Business Sector
                </label>
                <select
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="all">All Sectors</option>
                  <option value="Hospitality & Resort Ops">Hospitality & Resort Ops</option>
                  <option value="Real Estate & Development">Real Estate & Development</option>
                  <option value="Corporate & Finance">Corporate & Finance</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Location
                </label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="all">All Locations</option>
                  <option value="Sharm">Sharm El Sheikh (South Sinai)</option>
                  <option value="Cairo">Cairo (Mohandessin / New Cairo)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Employment Type
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="all">All Types</option>
                  <option value="Full-time">Full-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Remote">Remote</option>
                </select>
              </div>
            </div>
          </div>

          {/* Job Listings Grid */}
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Showing {filteredJobs.length} open position{filteredJobs.length === 1 ? '' : 's'}</span>
              <span>Updated in real-time</span>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto" />
                <h3 className="text-sm font-semibold text-white">No positions match your search</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Try adjusting your filters or search keywords to view other open career opportunities.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSectorFilter('all');
                    setLocationFilter('all');
                    setTypeFilter('all');
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-amber-300 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredJobs.map((job) => (
                <div
                  key={job.id}
                  className="group p-5 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 transition-all space-y-4 shadow-sm"
                >
                  {/* Top Line: Title & Apply Button */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <h2 className="text-base sm:text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
                        {job.title}
                      </h2>
                      
                      {/* Zero-Pill Unboxed Metadata with Dot Separators */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <span className="text-amber-400 font-medium">{job.company}</span>
                        <span aria-hidden="true">·</span>
                        <span>{job.business_sector}</span>
                        <span aria-hidden="true">·</span>
                        <span>{job.location}</span>
                        <span aria-hidden="true">·</span>
                        <span>{job.type}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setSelectedJob(job)}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => {
                          setSelectedJob(job);
                          setShowApplyModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
                      >
                        <span>Apply Now</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Description snippet */}
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {job.description}
                  </p>

                  {/* Skills & Compensation Line */}
                  <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1 text-slate-400">
                      <span className="font-semibold text-slate-300 mr-1">Required Skills:</span>
                      {job.required_skills.slice(0, 4).map((s, idx) => (
                        <span key={idx} className="text-slate-300 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800/80 text-[11px]">
                          {s}
                        </span>
                      ))}
                      {job.required_skills.length > 4 && (
                        <span className="text-slate-500 text-[11px]">+{job.required_skills.length - 4} more</span>
                      )}
                    </div>

                    {job.salary_range && (
                      <div className="text-slate-300 font-medium shrink-0 flex items-center gap-1 text-[11px]">
                        <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{job.salary_range}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: TRACK APPLICATION STATUS */}
      {activeTab === 'track_status' && (
        <div className="space-y-6 max-w-3xl mx-auto">
          {/* Lookup Input */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-amber-400" />
                Track Your Application Progress
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Enter your Application Reference ID (e.g. <code>HR-APP-2026-00101</code>) or your registered Email Address:
              </p>
            </div>

            <form onSubmit={handleTrackLookup} className="flex gap-2">
              <input
                type="text"
                value={trackQuery}
                onChange={(e) => setTrackQuery(e.target.value)}
                placeholder="Enter Application ID or Email..."
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all cursor-pointer shrink-0"
              >
                Track Status
              </button>
            </form>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>Quick Test ID:</span>
              <button
                type="button"
                onClick={() => {
                  setTrackQuery('HR-APP-2026-00101');
                }}
                className="text-amber-400 hover:underline font-mono"
              >
                HR-APP-2026-00101 (Youssef El-Masry)
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => {
                  setTrackQuery('HR-APP-2026-00102');
                }}
                className="text-amber-400 hover:underline font-mono"
              >
                HR-APP-2026-00102 (Mariam Farag)
              </button>
            </div>
          </div>

          {/* Results Display */}
          {trackSearched && !trackedApplicant && (
            <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <h3 className="text-sm font-semibold text-white">No Application Found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Please double-check your Application ID or Email. If you applied via WhatsApp, try entering your phone number.
              </p>
            </div>
          )}

          {trackedApplicant && (
            <div className="space-y-6">
              {/* Applicant Card */}
              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div>
                    <span className="text-[11px] font-mono text-amber-400 font-semibold">{trackedApplicant.id}</span>
                    <h3 className="text-lg font-bold text-white mt-0.5">{trackedApplicant.applicant_name}</h3>
                    <p className="text-xs text-slate-400">{trackedApplicant.job_title} · {trackedApplicant.company}</p>
                  </div>

                  <div className="px-3.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold self-start sm:self-auto">
                    Current Stage: {trackedApplicant.status}
                  </div>
                </div>

                {/* 5-Step Pipeline Progress Stepper */}
                <div className="space-y-3">
                  <span className="text-xs font-medium text-slate-400">Recruitment Pipeline Timeline</span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                    {[
                      { step: 'Applied', desc: 'Application Received' },
                      { step: 'AI Screened', desc: 'Skills & Language Check' },
                      { step: 'Interview Scheduled', desc: 'Panel Interview' },
                      { step: 'Shortlisted', desc: 'Executive Review' },
                      { step: 'Offered', desc: 'Contract Offer' }
                    ].map((st, i) => {
                      const stages = ['Applied', 'AI Screened', 'Interview Scheduled', 'Shortlisted', 'Offered', 'Hired'];
                      const currentIdx = stages.indexOf(trackedApplicant.status);
                      const stepIdx = stages.indexOf(st.step);
                      const isPassed = currentIdx >= stepIdx;
                      const isCurrent = trackedApplicant.status === st.step;

                      return (
                        <div
                          key={i}
                          className={`p-3 rounded-xl border transition-all ${
                            isCurrent
                              ? 'bg-amber-500/10 border-amber-500/60 text-white font-semibold'
                              : isPassed
                              ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-300'
                              : 'bg-slate-950 border-slate-800/80 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center justify-center mb-1">
                            {isPassed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Clock className="w-4 h-4 text-slate-600" />
                            )}
                          </div>
                          <p className="text-xs font-medium">{st.step}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{st.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Scheduled Interviews Box if any */}
                {trackedApplicant.interviews && trackedApplicant.interviews.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-amber-400" />
                        Confirmed Interview Schedule
                      </h4>
                      <span className="text-[11px] text-emerald-400 font-semibold">Calendar Synchronized</span>
                    </div>

                    {trackedApplicant.interviews.map((intv) => (
                      <div key={intv.id} className="p-3 rounded-lg bg-slate-900 border border-slate-800/80 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{intv.round_name}</span>
                          <span className="text-amber-400">{intv.platform}</span>
                        </div>
                        <p className="text-slate-400">
                          With: {intv.interviewer_name} ({intv.interviewer_role})
                        </p>
                        <p className="text-slate-400">
                          Scheduled: {new Date(intv.scheduled_datetime).toLocaleString()}
                        </p>
                        {intv.location_or_link && (
                          <div className="pt-1">
                            <a
                              href={intv.location_or_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                            >
                              Join Video Room: {intv.location_or_link}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Candidate Experience Survey */}
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-400" />
                    How has your application & interview experience been?
                  </h4>

                  {surveySubmitted ? (
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-900/60 text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Thank you for your valuable feedback! Your response helps us continuously enhance candidate care.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setSurveyRating(star)}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              surveyRating >= star 
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' 
                                : 'bg-slate-950 border-slate-800 text-slate-600'
                            }`}
                          >
                            <Star className="w-4 h-4 fill-current" />
                          </button>
                        ))}
                        <span className="text-xs text-slate-400 ml-2">({surveyRating} / 5 Stars)</span>
                      </div>

                      <textarea
                        rows={2}
                        value={surveyFeedback}
                        onChange={(e) => setSurveyFeedback(e.target.value)}
                        placeholder="Share any comments about recruiter communication, scheduling ease, or interview transparency..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                      />

                      <button
                        onClick={async () => {
                          await onSubmitSurvey(trackedApplicant.id, surveyRating, surveyFeedback);
                          setSurveySubmitted(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Submit Feedback
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: AI CAREER ASSISTANT CHATBOT */}
      {activeTab === 'career_bot' && (
        <div className="max-w-3xl mx-auto rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl flex flex-col h-[580px]">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">TalentPulse AI Career Guide</h3>
                <p className="text-[11px] text-slate-400">24/7 Red Sea & Cairo Candidate Advisory</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Online
            </span>
          </div>

          {/* Quick FAQ Chips */}
          <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-[11px]">
            <span className="text-slate-500 shrink-0">Ask about:</span>
            {[
              "Resort housing in Sharm",
              "Interview stages & timeline",
              "Russian / Italian allowances",
              "Il Mercato commercial roles"
            ].map((topic, i) => (
              <button
                key={i}
                onClick={() => handleSendBotMessage(topic)}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 shrink-0 transition-colors cursor-pointer"
              >
                {topic}
              </button>
            ))}
          </div>

          {/* Message List */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
            {botMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'bot' && (
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium rounded-br-sm'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-sm shadow-sm'
                  }`}
                >
                  <p>{msg.text}</p>
                  <span
                    className={`text-[10px] mt-1 block ${
                      msg.sender === 'user' ? 'text-slate-800 text-right' : 'text-slate-500'
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
              </div>
            ))}

            {botTyping && (
              <div className="flex gap-2.5 items-center text-xs text-slate-500">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Bot className="w-4 h-4" />
                </div>
                <span className="italic">Career Assistant is typing...</span>
              </div>
            )}
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendBotMessage();
            }}
            className="p-3 border-t border-slate-800 bg-slate-900 flex gap-2"
          >
            <input
              type="text"
              value={botInput}
              onChange={(e) => setBotInput(e.target.value)}
              placeholder="Type your question about benefits, relocations, or hiring..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={!botInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* JOB DETAIL MODAL */}
      {selectedJob && !showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 my-auto">
            <button
              onClick={() => setSelectedJob(null)}
              className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="text-xs text-amber-400 font-semibold uppercase">{selectedJob.company}</span>
              <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">{selectedJob.title}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-2">
                <span>{selectedJob.department}</span>
                <span>·</span>
                <span>{selectedJob.location}</span>
                <span>·</span>
                <span>{selectedJob.type}</span>
                {selectedJob.salary_range && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-400 font-medium">{selectedJob.salary_range}</span>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Role Overview</h3>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                {selectedJob.description}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Required Skills & Capabilities</h3>
              <div className="flex flex-wrap gap-1.5">
                {selectedJob.required_skills.map((s, idx) => (
                  <span key={idx} className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Holding Culture & Values</h3>
              <div className="flex flex-wrap gap-1.5">
                {selectedJob.cultural_values.map((v, idx) => (
                  <span key={idx} className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                    {v}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold"
              >
                Close
              </button>
              <button
                onClick={() => setShowApplyModal(true)}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-2"
              >
                <span>Apply for this Role</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK APPLY MODAL */}
      {selectedJob && showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 my-auto">
            <button
              onClick={() => {
                setShowApplyModal(false);
                setApplySuccessCode(null);
              }}
              className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {applySuccessCode ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white">Application Successfully Submitted!</h2>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  Your profile has been ingested into our AI ATS pipeline. You will receive an automated confirmation and WhatsApp invitation shortly.
                </p>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-sm text-amber-300 inline-block">
                  Reference ID: <strong>{applySuccessCode}</strong>
                </div>
                <p className="text-[11px] text-slate-400">Save this ID to track your status at any time.</p>
                <div className="pt-2">
                  <button
                    onClick={() => {
                      setShowApplyModal(false);
                      setSelectedJob(null);
                      setApplySuccessCode(null);
                      setActiveTab('track_status');
                      setTrackQuery(applySuccessCode);
                    }}
                    className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                  >
                    Track Application Now
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleApplySubmit} className="space-y-4">
                <div>
                  <span className="text-[11px] text-amber-400 font-semibold uppercase">{selectedJob.company}</span>
                  <h2 className="text-xl font-bold text-white mt-0.5">Apply for {selectedJob.title}</h2>
                  <p className="text-xs text-slate-400">Takes less than 2 minutes. Automated AI resume screening enabled.</p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={applyName}
                      onChange={(e) => setApplyName(e.target.value)}
                      placeholder="e.g. Karim Mansour"
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                      <input
                        type="email"
                        required
                        value={applyEmail}
                        onChange={(e) => setApplyEmail(e.target.value)}
                        placeholder="karim@domain.com"
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">WhatsApp / Phone Number</label>
                      <input
                        type="tel"
                        required
                        value={applyPhone}
                        onChange={(e) => setApplyPhone(e.target.value)}
                        placeholder="+201012345678"
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-300">Resume / CV Profile Summary</label>
                      <span className="text-[11px] text-slate-500">Paste plain text or LinkedIn bio</span>
                    </div>
                    <textarea
                      rows={5}
                      required
                      value={applyCvText}
                      onChange={(e) => setApplyCvText(e.target.value)}
                      placeholder="Paste your resume work history, languages spoken, hospitality or retail certifications, and key achievements..."
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-mono text-[11px]"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowApplyModal(false)}
                    className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-2"
                  >
                    {isSubmitting ? 'Ingesting Application...' : 'Submit Application'}
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

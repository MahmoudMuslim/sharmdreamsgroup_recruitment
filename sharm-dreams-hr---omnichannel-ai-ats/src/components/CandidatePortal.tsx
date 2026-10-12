import React, { useState } from 'react';
import { JobPosition, JobApplicant } from '../types';
import { 
  Briefcase, MapPin, Building2, Search, Filter, 
  Send, Sparkles, CheckCircle2, Calendar, Clock, 
  MessageCircle, Star, ThumbsUp, ArrowRight, UserCheck,
  ChevronRight, Bot, HelpCircle, ShieldCheck, X
} from 'lucide-react';

interface CandidatePortalProps {
  jobs: JobPosition[];
  applicants: JobApplicant[];
  onApply: (candidateData: any) => Promise<void>;
  onSubmitSurvey: (applicantId: string, rating: number, feedback: string) => Promise<void>;
}

export const CandidatePortal: React.FC<CandidatePortalProps> = ({
  jobs,
  applicants,
  onApply,
  onSubmitSurvey
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'jobs' | 'track' | 'bot'>('jobs');
  const [searchJob, setSearchJob] = useState('');
  const [selectedJob, setSelectedJob] = useState<JobPosition | null>(null);

  // Application Modal state
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyName, setApplyName] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyPhone, setApplyPhone] = useState('+2010');
  const [applyCvText, setApplyCvText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  // Tracking state
  const [trackingIdOrEmail, setTrackingIdOrEmail] = useState('');
  const [trackedApplicant, setTrackedApplicant] = useState<JobApplicant | null>(null);

  // Survey state
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [surveyRating, setSurveyRating] = useState(5);
  const [surveyFeedbackText, setSurveyFeedbackText] = useState('');
  const [surveySuccess, setSurveySuccess] = useState(false);

  // Candidate Chatbot state
  const [botMessages, setBotMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string }>>([
    {
      sender: 'bot',
      text: "Hello! I am the TalentPulse AI Recruitment Assistant for Sharm Dreams Group. I can answer questions about our resort benefits, interview stages, dress code, and commercial projects like Il Mercato. How can I help you today?"
    }
  ]);
  const [botInput, setBotInput] = useState('');
  const [botTyping, setBotTyping] = useState(false);

  const filteredJobs = jobs.filter(j => 
    j.title.toLowerCase().includes(searchJob.toLowerCase()) ||
    j.company.toLowerCase().includes(searchJob.toLowerCase()) ||
    j.location.toLowerCase().includes(searchJob.toLowerCase()) ||
    j.required_skills.some(s => s.toLowerCase().includes(searchJob.toLowerCase()))
  );

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyName || !applyEmail || !selectedJob) return;
    setIsSubmitting(true);
    try {
      await onApply({
        applicant_name: applyName,
        email_address: applyEmail,
        phone_number: applyPhone,
        company: selectedJob.company,
        custom_business_sector: selectedJob.business_sector,
        job_title: selectedJob.title,
        custom_raw_cv_text: applyCvText || `Applicant applied for ${selectedJob.title}`
      });
      setApplySuccess("Your application has been received and registered into our AI ATS pipeline! You can now track your application progress.");
      setTimeout(() => {
        setShowApplyModal(false);
        setApplySuccess(null);
        setApplyName('');
        setApplyEmail('');
        setApplyCvText('');
      }, 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTrackLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const query = trackingIdOrEmail.trim().toLowerCase();
    const found = applicants.find(a => 
      a.id.toLowerCase() === query || 
      a.email_address.toLowerCase() === query ||
      a.phone_number.replace(/\D/g, '').includes(query.replace(/\D/g, ''))
    );
    setTrackedApplicant(found || null);
  };

  const handleSurveySubmit = async () => {
    if (!trackedApplicant) return;
    await onSubmitSurvey(trackedApplicant.id, surveyRating, surveyFeedbackText);
    setSurveySuccess(true);
    setTimeout(() => {
      setShowSurveyModal(false);
      setSurveySuccess(false);
    }, 2000);
  };

  const handleSendBotMessage = (textToSend?: string) => {
    const q = textToSend || botInput;
    if (!q.trim()) return;

    setBotMessages(prev => [...prev, { sender: 'user', text: q }]);
    setBotInput('');
    setBotTyping(true);

    setTimeout(() => {
      let botReply = "Thank you for asking! Sharm Dreams Group prioritizes exceptional hospitality and employee growth. Our recruitment committee typically reviews applications within 48 hours.";
      const lowerQ = q.toLowerCase();

      if (lowerQ.includes('interview') || lowerQ.includes('process')) {
        botReply = "Our interview process consists of 3 streamlined stages: 1) Automated AI Resume Screening & Multilingual check, 2) Technical interview with the Department Director, and 3) Final cultural alignment panel with Executive HR.";
      } else if (lowerQ.includes('accommodation') || lowerQ.includes('housing') || lowerQ.includes('sharm')) {
        botReply = "For positions based in Sharm El Sheikh (Jaz Sharm Dreams, Fayrouz Resort), Sharm Dreams Group provides full executive resort staff housing, comprehensive meal allowances, private beach access, and return flights/transfers from Cairo.";
      } else if (lowerQ.includes('language') || lowerQ.includes('russian') || lowerQ.includes('italian')) {
        botReply = "For guest-facing roles in our Red Sea resorts, Russian and Italian proficiency is heavily rewarded with language allowances. English is the official working operational language across holding entities.";
      } else if (lowerQ.includes('mercato') || lowerQ.includes('real estate')) {
        botReply = "Il Mercato is our landmark 60,000 sqm open-air pedestrian commercial lifestyle center in Sharm El Sheikh, housing regional retail, international dining, and entertainment venues. Leasing roles work across Cairo and South Sinai.";
      }

      setBotMessages(prev => [...prev, { sender: 'bot', text: botReply }]);
      setBotTyping(false);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/60 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl overflow-hidden">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            Candidate Self-Service Career Portal
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Build Your Career with <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">Sharm Dreams Group</span>
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
            Explore premier opportunities across our luxury Red Sea resorts, landmark retail lifestyle centers (Il Mercato), and corporate executive offices. Experience real-time application tracking, AI-powered interview prep, and direct WhatsApp recruiter coordination.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => setActiveSubTab('jobs')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeSubTab === 'jobs'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              Browse Open Positions ({jobs.length})
            </button>
            <button
              onClick={() => setActiveSubTab('track')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeSubTab === 'track'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              Track My Application Status
            </button>
            <button
              onClick={() => setActiveSubTab('bot')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${
                activeSubTab === 'bot'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              Ask AI Recruiter Bot
            </button>
          </div>
        </div>
      </div>

      {/* SubTab 1: Open Positions */}
      {activeSubTab === 'jobs' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-3 justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search job title, skills, location..."
                value={searchJob}
                onChange={(e) => setSearchJob(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9.5 pr-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-amber-500 outline-none"
              />
            </div>
            <div className="text-xs text-slate-400">
              Showing <b className="text-amber-400">{filteredJobs.length}</b> live vacancies
            </div>
          </div>

          {/* Job Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredJobs.map(job => (
              <div
                key={job.id}
                className="bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 sm:p-6 transition-all shadow-md flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        {job.business_sector}
                      </span>
                      <h3 className="text-lg font-bold text-white mt-1.5 hover:text-amber-300 transition-colors">
                        {job.title}
                      </h3>
                      <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-500" />
                        {job.company}
                      </div>
                    </div>

                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {job.type}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 mt-3 line-clamp-2 leading-relaxed">
                    {job.description}
                  </p>

                  <div className="mt-3.5 space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{job.location}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {job.required_skills.slice(0, 3).map(skill => (
                        <span key={skill} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-cyan-300">
                          {skill}
                        </span>
                      ))}
                      {job.required_skills.length > 3 && (
                        <span className="text-[11px] text-slate-500">
                          +{job.required_skills.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 font-mono">
                    {job.salary_range}
                  </span>

                  <button
                    onClick={() => {
                      setSelectedJob(job);
                      setShowApplyModal(true);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-md shadow-amber-950 transition-colors"
                  >
                    Apply Now
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SubTab 2: Track My Application */}
      {activeSubTab === 'track' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl mx-auto shadow-md space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-amber-400" />
                Track Your Application Status
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Enter your application ID (e.g. <code className="text-amber-300">HR-APP-2026-00101</code>) or your registered email address.
              </p>
            </div>

            <form onSubmit={handleTrackLookup} className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. youssef.elmasry@gmail.com or HR-APP-2026-00101"
                value={trackingIdOrEmail}
                onChange={(e) => setTrackingIdOrEmail(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-amber-500 outline-none font-mono"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors shrink-0"
              >
                Track Status
              </button>
            </form>
          </div>

          {/* Tracked Applicant Card */}
          {trackedApplicant && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-3xl mx-auto shadow-xl space-y-6 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-xs font-mono text-slate-400">{trackedApplicant.id}</span>
                  <h3 className="text-xl font-bold text-white">{trackedApplicant.applicant_name}</h3>
                  <div className="text-xs text-amber-400 font-medium">{trackedApplicant.job_title} • {trackedApplicant.company}</div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs">
                    Current Stage: {trackedApplicant.status}
                  </span>
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="py-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Selection Pipeline Progress
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  {[
                    { label: 'Applied', done: true },
                    { label: 'AI Screened', done: trackedApplicant.status !== 'Applied' },
                    { label: 'Interview', done: ['Interview Scheduled', 'Shortlisted', 'Offered', 'Hired'].includes(trackedApplicant.status) },
                    { label: 'Offer', done: ['Offered', 'Hired'].includes(trackedApplicant.status) },
                    { label: 'Hired', done: trackedApplicant.status === 'Hired' }
                  ].map((step, idx) => (
                    <div
                      key={step.label}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 ${
                        step.done
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950/60 border-slate-800 text-slate-500'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        step.done ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {idx + 1}
                      </div>
                      <span className="font-medium text-[11px]">{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scheduled Interview Details if any */}
              {trackedApplicant.interviews && trackedApplicant.interviews.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                    <Calendar className="w-4 h-4" />
                    Confirmed Interview Schedule
                  </div>
                  {trackedApplicant.interviews.map(int => (
                    <div key={int.id} className="text-xs text-slate-300 space-y-1">
                      <div><b>Round:</b> {int.round_name}</div>
                      <div><b>Interviewer:</b> {int.interviewer_name} ({int.interviewer_role})</div>
                      <div><b>Date & Time:</b> {new Date(int.scheduled_datetime).toLocaleString()}</div>
                      <div><b>Platform / Location:</b> <a href={int.location_or_link} target="_blank" rel="noreferrer" className="text-amber-400 underline">{int.location_or_link}</a></div>
                    </div>
                  ))}
                </div>
              )}

              {/* Candidate Experience Survey trigger */}
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-amber-300">How was your interview experience?</div>
                  <div className="text-[11px] text-slate-400">Help us improve by leaving brief anonymous feedback for our recruitment leadership.</div>
                </div>
                <button
                  onClick={() => setShowSurveyModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition-colors"
                >
                  Give Feedback
                </button>
              </div>
            </div>
          )}

          {trackedApplicant === null && trackingIdOrEmail && (
            <div className="text-center py-8 text-xs text-slate-400">
              No applicant found matching "{trackingIdOrEmail}". Try testing with sample ID <code className="text-amber-300">HR-APP-2026-00101</code>.
            </div>
          )}
        </div>
      )}

      {/* SubTab 3: AI Recruiter Assistant Chatbot */}
      {activeSubTab === 'bot' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl mx-auto overflow-hidden shadow-xl flex flex-col h-[520px]">
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 font-bold">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">TalentPulse Candidate Assistant</h3>
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Online • Sharm Dreams Group Knowledge Base
                </span>
              </div>
            </div>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60">
            {botMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium'
                      : 'bg-slate-800/90 text-slate-200 border border-slate-700/60'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {botTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-800/90 rounded-2xl p-3 text-xs text-slate-400 italic">
                  Recruiter Bot is thinking...
                </div>
              </div>
            )}
          </div>

          {/* Quick FAQ Prompts */}
          <div className="px-4 py-2 bg-slate-950 border-t border-slate-800/60 flex items-center gap-1.5 overflow-x-auto text-[11px]">
            <span className="text-slate-500 text-[10px] shrink-0">Ask:</span>
            {[
              "What are the interview stages?",
              "Do you provide resort housing in Sharm?",
              "What European languages are prioritized?",
              "Tell me about Il Mercato project"
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => handleSendBotMessage(prompt)}
                className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <div className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2">
            <input
              type="text"
              placeholder="Ask about culture, benefits, interview tips..."
              value={botInput}
              onChange={(e) => setBotInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendBotMessage()}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={() => handleSendBotMessage()}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Apply Modal */}
      {showApplyModal && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold text-amber-400">Direct Application</span>
                <h3 className="text-lg font-bold text-white">{selectedJob.title}</h3>
                <div className="text-xs text-slate-400">{selectedJob.company}</div>
              </div>
              <button onClick={() => setShowApplyModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {applySuccess ? (
              <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{applySuccess}</span>
              </div>
            ) : (
              <form onSubmit={handleApplySubmit} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mahmoud Mostafa"
                    value={applyName}
                    onChange={(e) => setApplyName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-300 block mb-1 font-medium">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="name@gmail.com"
                      value={applyEmail}
                      onChange={(e) => setApplyEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-300 block mb-1 font-medium">WhatsApp Mobile</label>
                    <input
                      type="tel"
                      required
                      placeholder="+2010..."
                      value={applyPhone}
                      onChange={(e) => setApplyPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Resume / CV Summary Text</label>
                  <textarea
                    rows={4}
                    placeholder="Paste your resume text, achievements, language fluency, or key skills..."
                    value={applyCvText}
                    onChange={(e) => setApplyCvText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs leading-relaxed"
                  />
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-[11px] text-slate-400 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Your resume will be processed with bias-free skill matching and encrypted under AES-256.</span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowApplyModal(false)}
                    className="px-3.5 py-2 rounded-xl text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 shadow-md shadow-amber-950"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Application'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Survey Modal */}
      {showSurveyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                Candidate Experience Survey
              </h3>
              <button onClick={() => setShowSurveyModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {surveySuccess ? (
              <div className="p-3.5 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Thank you! Your feedback helps us build a world-class candidate journey.</span>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Overall Rating</label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setSurveyRating(star)}
                        className={`p-2 rounded-lg border transition-colors ${
                          star <= surveyRating
                            ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                            : 'bg-slate-950 border-slate-800 text-slate-600'
                        }`}
                      >
                        <Star className="w-5 h-5 fill-current" />
                      </button>
                    ))}
                    <span className="text-slate-400 text-xs ml-2 font-bold">{surveyRating} / 5 Stars</span>
                  </div>
                </div>

                <div>
                  <label className="text-slate-300 block mb-1 font-medium">Your Feedback / Comments</label>
                  <textarea
                    rows={3}
                    placeholder="How was the communication, interviewer transparency, and scheduling flexibility?"
                    value={surveyFeedbackText}
                    onChange={(e) => setSurveyFeedbackText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setShowSurveyModal(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSurveySubmit}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                  >
                    Submit Feedback
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

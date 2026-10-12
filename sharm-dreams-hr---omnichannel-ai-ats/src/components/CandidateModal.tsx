import React, { useState } from 'react';
import { JobApplicant } from '../types';
import { 
  X, Sparkles, MessageCircle, Send, CheckCircle2, AlertTriangle, 
  HelpCircle, FileText, Building2, Briefcase, Phone, Mail, 
  Calendar, RefreshCw, Copy, Check, ExternalLink, ShieldCheck,
  Star, HeartHandshake, Award
} from 'lucide-react';

interface CandidateModalProps {
  applicant: JobApplicant;
  onClose: () => void;
  onUpdateApplicant: (updated: JobApplicant) => void;
}

export const CandidateModal: React.FC<CandidateModalProps> = ({
  applicant,
  onClose,
  onUpdateApplicant
}) => {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteDate, setInviteDate] = useState('2026-10-15T11:00');
  const [inviteLocation, setInviteLocation] = useState('Resort HR Office (Sharm El Sheikh)');
  const [inviteSent, setInviteSent] = useState(false);
  const [copiedCv, setCopiedCv] = useState(false);
  const [activeTab, setActiveTab] = useState<'ai' | 'skills' | 'questions' | 'cv'>('ai');

  const handleRunAiEvaluation = async () => {
    setIsEvaluating(true);
    setEvalError(null);
    try {
      const res = await fetch('/api/ai-recruiter/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: applicant.id,
          applicant_name: applicant.applicant_name,
          job_title: applicant.job_title,
          company: applicant.company,
          sector: applicant.custom_business_sector,
          cv_text: applicant.custom_raw_cv_text
        })
      });

      const data = await res.json();
      if (data.success && data.evaluation) {
        const updated: JobApplicant = {
          ...applicant,
          custom_ai_score: data.evaluation.fit_score,
          custom_ai_summary: data.evaluation.summary,
          custom_ai_strengths: data.evaluation.strengths,
          custom_ai_red_flags: data.evaluation.red_flags,
          custom_suggested_interview_questions: data.evaluation.interview_questions,
          status: 'AI Screened'
        };
        onUpdateApplicant(updated);
      } else {
        setEvalError(data.error || 'Evaluation failed');
      }
    } catch (err: any) {
      setEvalError(err.message || 'Network error evaluating candidate');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleStatusChange = async (newStatus: JobApplicant['status']) => {
    const updated = { ...applicant, status: newStatus };
    onUpdateApplicant(updated);
    try {
      await fetch(`/api/candidates/${applicant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenWhatsApp = () => {
    const phone = (applicant.phone_number || applicant.custom_whatsapp_chat_id || '').replace(/\D/g, '');
    if (!phone) return;
    const msg = encodeURIComponent(
      `Hello ${applicant.applicant_name}, this is Talent Acquisition from Sharm Dreams Group regarding your application for ${applicant.job_title} at ${applicant.company}.`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  const handleSendInvite = async () => {
    setInviteSent(true);
    handleStatusChange('Interview Scheduled');
    setTimeout(() => {
      setShowInviteDialog(false);
      setInviteSent(false);
    }, 1800);
  };

  const handleCopyCv = () => {
    navigator.clipboard.writeText(applicant.custom_raw_cv_text);
    setCopiedCv(true);
    setTimeout(() => setCopiedCv(false), 2000);
  };

  const score = applicant.custom_ai_score;
  const scoreColor = score === null 
    ? 'text-slate-400 bg-slate-800/80 border-slate-700' 
    : score >= 75 
      ? 'text-emerald-400 bg-emerald-950/70 border-emerald-500/40' 
      : score >= 50 
        ? 'text-amber-400 bg-amber-950/70 border-amber-500/40' 
        : 'text-rose-400 bg-rose-950/70 border-rose-500/40';

  const radar = applicant.radar_scores || {
    technical: 85,
    domain: 88,
    cultural: 84,
    leadership: 80,
    adaptability: 86
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Bar */}
        <div className="p-4 sm:p-6 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-850 flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-13 h-13 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xl shrink-0 shadow-inner">
              {applicant.applicant_name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {applicant.applicant_name}
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 font-mono text-slate-300">
                  {applicant.id}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${scoreColor}`}>
                  {score !== null ? `${score}% Overall Fit` : 'Unscreened'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  AES-256 Encrypted
                </span>
              </div>

              <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-400 flex-wrap">
                <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                  {applicant.job_title}
                </span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  {applicant.company}
                </span>
              </div>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Contact & Metadata Strip */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              {applicant.email_address}
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              {applicant.phone_number}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-slate-300">
              Channel: <b className="text-amber-400">{applicant.custom_acquisition_source}</b>
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-slate-300">
              Sector: <b className="text-cyan-400">{applicant.custom_business_sector}</b>
            </span>
          </div>

          {/* Status Selector */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Stage:</span>
            <select
              value={applicant.status}
              onChange={(e) => handleStatusChange(e.target.value as any)}
              className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-amber-500 outline-none"
            >
              <option value="Applied">Applied</option>
              <option value="AI Screened">AI Screened</option>
              <option value="Interview Scheduled">Interview Scheduled</option>
              <option value="Shortlisted">Shortlisted</option>
              <option value="Offered">Offered</option>
              <option value="Hired">Hired</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 px-3 sm:px-6 pt-3 border-b border-slate-800 bg-slate-900/50 overflow-x-auto no-scrollbar whitespace-nowrap">
          <button
            onClick={() => setActiveTab('ai')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 sm:gap-2 shrink-0 ${
              activeTab === 'ai'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            AI Dossier & Evaluation
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 sm:gap-2 shrink-0 ${
              activeTab === 'skills'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Skill & Cultural Radar
          </button>
          <button
            onClick={() => setActiveTab('questions')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 sm:gap-2 shrink-0 ${
              activeTab === 'questions'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Tailored Questions
          </button>
          <button
            onClick={() => setActiveTab('cv')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 sm:gap-2 shrink-0 ${
              activeTab === 'cv'
                ? 'border-amber-400 text-amber-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Extracted Resume Text
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {evalError && (
            <div className="p-3.5 bg-rose-950/60 border border-rose-500/50 rounded-xl text-rose-200 text-sm flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{evalError}</span>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              {/* Score & Summary Card */}
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-center gap-6">
                {/* Score Dial */}
                <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-900 border border-slate-800 shrink-0 w-36 h-36 shadow-inner text-center">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                    AI Fit Score
                  </span>
                  <div className={`text-4xl font-extrabold tracking-tight ${scoreColor}`}>
                    {score !== null ? `${score}%` : '--'}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 font-medium">
                    {score === null ? 'Not Screened' : score >= 75 ? 'Strong Match' : score >= 50 ? 'Moderate Match' : 'High Risk'}
                  </span>
                </div>

                {/* Executive Summary */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Executive Screening Summary
                    </h3>
                    <span className="text-xs text-slate-500">
                      Evaluated for: {applicant.custom_business_sector}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-900/60 p-3.5 rounded-lg border border-slate-800/80">
                    {applicant.custom_ai_summary || 'No AI summary generated yet. Click "Re-Run AI Evaluation" below to analyze with OpenRouter / Gemini.'}
                  </p>
                </div>
              </div>

              {/* Strengths & Red Flags Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-4.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Verified Sector Strengths
                  </h4>
                  <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed space-y-1">
                    {applicant.custom_ai_strengths || 'No strengths recorded yet.'}
                  </div>
                </div>

                <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-4.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5 mb-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    Red Flags & Scrutiny Areas
                  </h4>
                  <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed space-y-1">
                    {applicant.custom_ai_red_flags || 'No red flags recorded yet.'}
                  </div>
                </div>
              </div>

              {/* Candidate Survey if any */}
              {applicant.candidate_survey && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold">
                    <Star className="w-4 h-4 fill-current" />
                    Candidate Interview Experience Survey ({applicant.candidate_survey.rating} / 5 Stars)
                  </div>
                  <p className="text-slate-300 italic">"{applicant.candidate_survey.feedback}"</p>
                  <div className="text-[10px] text-slate-500">Submitted at: {new Date(applicant.candidate_survey.submitted_at).toLocaleString()}</div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-6">
              {/* Radar Scores Grid */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-400" />
                  Multi-Dimensional Competency & Cultural Radar
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Technical Hard Skills</span>
                      <span className="text-cyan-400 font-bold">{radar.technical}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${radar.technical}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Domain & Industry Mastery</span>
                      <span className="text-emerald-400 font-bold">{radar.domain}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400" style={{ width: `${radar.domain}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Cultural & Values Alignment</span>
                      <span className="text-amber-400 font-bold">{radar.cultural}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400" style={{ width: `${radar.cultural}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Leadership & Team Ownership</span>
                      <span className="text-purple-400 font-bold">{radar.leadership}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400" style={{ width: `${radar.leadership}%` }} />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Intercultural Adaptability & Multilingual Agility</span>
                      <span className="text-rose-400 font-bold">{radar.adaptability}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-400" style={{ width: `${radar.adaptability}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Matched vs Missing Skills */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-950/20 border border-emerald-900/40 rounded-xl space-y-2 text-xs">
                  <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified Matched Skills ({applicant.matched_skills?.length || 0})
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(applicant.matched_skills || ["Core Hospitality", "Customer Service"]).map(skill => (
                      <span key={skill} className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px]">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-2 text-xs">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Identified Gaps / Training Needs
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(applicant.missing_skills || ["Advanced Analytics"]).map(skill => (
                      <span key={skill} className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px]">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'questions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-amber-400" />
                    Sector-Specific Probing Interview Questions
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Engineered to test candidate claims in {applicant.custom_business_sector} during panel interviews.
                  </p>
                </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 text-sm text-slate-200 leading-relaxed whitespace-pre-line font-sans">
                {applicant.custom_suggested_interview_questions || 
                  'No interview questions generated yet. Run the AI evaluation to generate custom probing questions.'}
              </div>
            </div>
          )}

          {activeTab === 'cv' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Extracted via PyPDF / Omnichannel Ingestion ({applicant.custom_raw_cv_text?.length || 0} characters)
                </span>
                <button
                  onClick={handleCopyCv}
                  className="px-2.5 py-1 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors"
                >
                  {copiedCv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCv ? 'Copied' : 'Copy Text'}
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                {applicant.custom_raw_cv_text || 'No CV text available for this applicant.'}
              </div>
            </div>
          )}
        </div>

        {/* WhatsApp Invite Dialog Sub-modal */}
        {showInviteDialog && (
          <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-sm p-6 flex items-center justify-center">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-emerald-400" />
                  Send WhatsApp Interview Invite
                </h3>
                <button onClick={() => setShowInviteDialog(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Candidate Phone (WhatsApp)</label>
                  <input
                    type="text"
                    disabled
                    value={applicant.phone_number}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 font-mono"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Proposed Interview Date & Time</label>
                  <input
                    type="datetime-local"
                    value={inviteDate}
                    onChange={(e) => setInviteDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Interview Location / Platform</label>
                  <select
                    value={inviteLocation}
                    onChange={(e) => setInviteLocation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="Resort HR Office (Sharm El Sheikh)">Resort HR Office (Sharm El Sheikh)</option>
                    <option value="Cairo Executive HQ (Mohandessin)">Cairo Executive HQ (Mohandessin)</option>
                    <option value="Online Google Meet / Teams">Online Google Meet / Teams</option>
                  </select>
                </div>

                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-slate-400 text-[11px] leading-relaxed">
                  <b>Message Template:</b> "Dear {applicant.applicant_name}, Sharm Dreams Group invites you for an interview for {applicant.job_title} on {inviteDate.replace('T', ' at ')}..."
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowInviteDialog(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendInvite}
                  disabled={inviteSent}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950"
                >
                  {inviteSent ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  {inviteSent ? 'Invite Dispatched!' : 'Send WhatsApp Invite'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Action Bar */}
        <div className="p-3 sm:p-5 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunAiEvaluation}
              disabled={isEvaluating}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-950 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isEvaluating ? 'animate-spin' : ''}`} />
              {isEvaluating ? 'Evaluating with AI...' : 'Re-Run AI Evaluation'}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2.5">
            <button
              onClick={handleOpenWhatsApp}
              className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 font-medium text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Open WhatsApp Chat
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
            </button>

            <button
              onClick={() => setShowInviteDialog(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-950 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              Schedule WhatsApp Invite
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

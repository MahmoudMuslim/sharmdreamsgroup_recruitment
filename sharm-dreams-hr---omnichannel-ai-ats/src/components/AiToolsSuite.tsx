import React, { useState } from 'react';
import { 
  Sparkles, Video, Send, FileCheck, Heart, 
  MessageCircle, Copy, Check, RefreshCw, AlertTriangle, 
  CheckCircle2, Bot, HelpCircle
} from 'lucide-react';
import { JobApplicant, JobPosition } from '../types';

interface AiToolsSuiteProps {
  applicants: JobApplicant[];
  jobs: JobPosition[];
}

export const AiToolsSuite: React.FC<AiToolsSuiteProps> = ({
  applicants,
  jobs
}) => {
  const [activeTool, setActiveTool] = useState<'sentiment' | 'outreach' | 'onboarding' | 'feedback'>('sentiment');

  // 1. Sentiment Analyzer State
  const [sentimentTranscript, setSentimentTranscript] = useState(
    "In my 6 years as VIP Guest Experience Manager at Sunrise Montemare, I learned that luxury hospitality isn't just about problem solving; it's about anticipating emotional needs before a guest even voices them. When charter flights were delayed and guests arrived stressed at 2 AM, my team and I set up express champagne check-ins. I love high-pressure environments and thrive when mentoring front desk staff."
  );
  const [sentimentRole, setSentimentRole] = useState("Guest Relations & VIP Services Manager");
  const [sentimentResult, setSentimentResult] = useState<any>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);

  // 2. Outreach State
  const [outreachName, setOutreachName] = useState("Karim Abdel-Razek, PMP");
  const [outreachSkills, setOutreachSkills] = useState("Commercial Retail Leasing, Luxury Malls, Regional F&B Deal Restructuring");
  const [outreachJob, setOutreachJob] = useState("Senior Commercial Leasing Director (Il Mercato)");
  const [outreachResult, setOutreachResult] = useState<any>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);

  // 3. Onboarding Roadmap State
  const [onboardingName, setOnboardingName] = useState(applicants[0]?.applicant_name || "Youssef El-Masry");
  const [onboardingRole, setOnboardingRole] = useState(applicants[0]?.job_title || "Guest Relations Manager");
  const [onboardingResult, setOnboardingResult] = useState<any>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);

  // 4. Empathetic Feedback State
  const [feedbackCandidate, setFeedbackCandidate] = useState(applicants[3]?.applicant_name || "Khaled Mostafa Zaki");
  const [feedbackRole, setFeedbackRole] = useState(applicants[3]?.job_title || "Executive Sous Chef");
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const runSentimentAnalysis = async () => {
    setSentimentLoading(true);
    try {
      const res = await fetch('/api/ai/sentiment-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interview_transcript: sentimentTranscript, role_context: sentimentRole })
      });
      const data = await res.json();
      setSentimentResult(data.analysis);
    } catch (e) {
      console.error(e);
    } finally {
      setSentimentLoading(false);
    }
  };

  const runOutreachGeneration = async () => {
    setOutreachLoading(true);
    try {
      const res = await fetch('/api/ai/passive-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: outreachName,
          candidate_skills: outreachSkills,
          job_title: outreachJob,
          channel: 'LinkedIn and WhatsApp'
        })
      });
      const data = await res.json();
      setOutreachResult(data.outreach);
    } catch (e) {
      console.error(e);
    } finally {
      setOutreachLoading(false);
    }
  };

  const runOnboardingGeneration = async () => {
    setOnboardingLoading(true);
    try {
      const res = await fetch('/api/ai/onboarding-roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: onboardingName,
          role_title: onboardingRole,
          missing_skills: ["European charter peak protocols", "Holding ERP expense reporting"]
        })
      });
      const data = await res.json();
      setOnboardingResult(data.roadmap);
    } catch (e) {
      console.error(e);
    } finally {
      setOnboardingLoading(false);
    }
  };

  const runFeedbackGeneration = () => {
    setFeedbackLoading(true);
    setTimeout(() => {
      setFeedbackResult(
`Dear ${feedbackCandidate},

Thank you very much for taking the time to interview with the Sharm Dreams Group culinary talent committee for the ${feedbackRole} position at Fayrouz Resort.

We were genuinely impressed by your deep passion for Mediterranean and Egyptian hospitality, as well as your valid NFSA food safety compliance track record. 

While we have chosen to proceed with a candidate possessing extensive executive volume management in 800+ key mega-resorts, our committee identified several outstanding qualities in your profile:
• Strong hot kitchen operational discipline and dedication to culinary hygiene.
• Honest, humble presentation of your career trajectory.

Actionable Recommendations for Future Executive Opportunities:
1. Culinary Cost Control: We recommend strengthening formal food cost variance modeling (targeting <28% in all-inclusive formats).
2. Language Proficiency: Investing in conversational English or German will significantly expand your eligibility for our 5-star international guest-facing luxury properties.

We will keep your profile active in our talent community for boutique property openings. We wish you continued success in your culinary career.

Warm regards,
Talent Acquisition Committee
Sharm Dreams Group`
      );
      setFeedbackLoading(false);
    }, 700);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4" />
            AI Enterprise Recruiting & HR Tools
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            AI Psychometrics, Sourcing & Onboarding Suite
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Harness modern Gemini generative intelligence for video response sentiment analysis, executive outreach campaigns, bespoke 30-60-90 onboarding plans, and empathetic feedback.
          </p>
        </div>
      </div>

      {/* Tool Selector Buttons */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTool('sentiment')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeTool === 'sentiment'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Video className="w-4 h-4" />
          Video Response Sentiment & Behavioral Assessor
        </button>

        <button
          onClick={() => setActiveTool('outreach')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeTool === 'outreach'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Send className="w-4 h-4" />
          Passive Candidate Sourcing & Outreach
        </button>

        <button
          onClick={() => setActiveTool('onboarding')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeTool === 'onboarding'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          Role-Specific 30-60-90 Onboarding Generator
        </button>

        <button
          onClick={() => setActiveTool('feedback')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all ${
            activeTool === 'feedback'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Heart className="w-4 h-4" />
          Empathetic Rejection & Feedback Loop
        </button>
      </div>

      {/* Tool 1: Sentiment Analysis */}
      {activeTool === 'sentiment' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Video className="w-5 h-5 text-amber-400" />
              Candidate Video / Audio Transcript Input
            </h3>
            <p className="text-xs text-slate-400">
              Paste interview speech-to-text transcript from candidate video interviews or phone screening recordings.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Role Context</label>
                <input
                  type="text"
                  value={sentimentRole}
                  onChange={(e) => setSentimentRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Candidate Response Transcript</label>
                <textarea
                  rows={6}
                  value={sentimentTranscript}
                  onChange={(e) => setSentimentTranscript(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs leading-relaxed"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={runSentimentAnalysis}
                  disabled={sentimentLoading}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-950 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {sentimentLoading ? 'Analyzing Behavioral Nuances...' : 'Run Behavioral Sentiment Analysis'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-emerald-400" />
                AI Behavioral & Sentiment Assessment
              </h3>

              {sentimentResult ? (
                <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-[11px] text-slate-400 font-medium">Sentiment Index</div>
                      <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                        {sentimentResult.sentiment_index}%
                      </div>
                    </div>
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-[11px] text-slate-400 font-medium">Executive Confidence</div>
                      <div className="text-2xl font-extrabold text-cyan-400 mt-1">
                        {sentimentResult.confidence_level}%
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs text-slate-300 space-y-1">
                    <div className="text-amber-400 font-bold">Detected Tone:</div>
                    <div>{sentimentResult.tone}</div>
                  </div>

                  <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs text-slate-300 space-y-1.5">
                    <div className="text-emerald-400 font-bold">Positive Behavioral Cues:</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      {sentimentResult.behavioral_cues?.map((c: string, idx: number) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-3.5 bg-rose-950/20 border border-rose-900/40 rounded-xl text-xs text-slate-300 space-y-1">
                    <div className="text-rose-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Behavioral Scrutiny Note:
                    </div>
                    <div className="text-[11px]">{sentimentResult.risk_flags?.[0] || 'No behavioral concerns identified.'}</div>
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center text-xs text-slate-500 italic">
                  Click "Run Behavioral Sentiment Analysis" to evaluate candidate resilience, empathy, and executive presence.
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-500 pt-3 border-t border-slate-800">
              Compliant with non-invasive AI recruiting standards and psychometric review guidelines.
            </div>
          </div>
        </div>
      )}

      {/* Tool 2: Outreach Generator */}
      {activeTool === 'outreach' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-amber-400" />
              Target Prospect Parameters
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Candidate Name</label>
                <input
                  type="text"
                  value={outreachName}
                  onChange={(e) => setOutreachName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Target Role</label>
                <input
                  type="text"
                  value={outreachJob}
                  onChange={(e) => setOutreachJob(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Noteworthy Skills & Accomplishments</label>
                <textarea
                  rows={3}
                  value={outreachSkills}
                  onChange={(e) => setOutreachSkills(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={runOutreachGeneration}
                  disabled={outreachLoading}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-950 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {outreachLoading ? 'Crafting Personalized Outreach...' : 'Generate Sourcing Outreach'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-400" />
              Generated Executive Outreach Templates
            </h3>

            {outreachResult ? (
              <div className="space-y-4 animate-in fade-in duration-200 text-xs">
                {/* WhatsApp Message */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                    <span className="flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4" />
                      WhatsApp Direct Scout Message
                    </span>
                    <button
                      onClick={() => handleCopy(outreachResult.whatsapp_template, 'wa')}
                      className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                    >
                      {copiedKey === 'wa' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedKey === 'wa' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-slate-300 leading-relaxed font-sans">
                    {outreachResult.whatsapp_template}
                  </p>
                </div>

                {/* Email Template */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-amber-400 font-bold">
                    <span>Executive Email / InMail Invitation</span>
                    <button
                      onClick={() => handleCopy(outreachResult.email_body, 'email')}
                      className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                    >
                      {copiedKey === 'email' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedKey === 'email' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-400"><b>Subject:</b> {outreachResult.subject_line}</div>
                  <p className="text-slate-300 leading-relaxed whitespace-pre-line font-sans">
                    {outreachResult.email_body}
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center text-xs text-slate-500 italic">
                Generate outreach templates tailored for passive candidate engagement.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tool 3: Onboarding Generator */}
      {activeTool === 'onboarding' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-amber-400" />
              New Hire Parameters
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">New Recruit Name</label>
                <input
                  type="text"
                  value={onboardingName}
                  onChange={(e) => setOnboardingName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Assigned Role & Department</label>
                <input
                  type="text"
                  value={onboardingRole}
                  onChange={(e) => setOnboardingRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={runOnboardingGeneration}
                  disabled={onboardingLoading}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-950 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {onboardingLoading ? 'Generating Roadmap...' : 'Generate 30-60-90 Checklist'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Tailored Onboarding Roadmap
            </h3>

            {onboardingResult ? (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
                  <b>Skill Gap Training Recommendation:</b> {onboardingResult.learning_roadmap}
                </div>

                <div className="space-y-2">
                  {onboardingResult.checklist?.map((item: any) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs gap-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[10px] text-amber-400">
                          {item.phase}
                        </span>
                        <span className="text-white font-medium">{item.task}</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                        {item.category}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-20 text-center text-xs text-slate-500 italic">
                Generate an onboarding roadmap tailored to the new hire's role and verified competency gaps.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tool 4: Empathetic Feedback Loop */}
      {activeTool === 'feedback' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-400" />
              Candidate Profile for Constructive Feedback
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Candidate Name</label>
                <input
                  type="text"
                  value={feedbackCandidate}
                  onChange={(e) => setFeedbackCandidate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Interviewed Role</label>
                <input
                  type="text"
                  value={feedbackRole}
                  onChange={(e) => setFeedbackRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={runFeedbackGeneration}
                  disabled={feedbackLoading}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-950 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {feedbackLoading ? 'Drafting Empathetic Letter...' : 'Generate Constructive Feedback'}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Heart className="w-5 h-5 text-amber-400" />
                Empathetic Candidate Feedback Letter
              </h3>
              {feedbackResult && (
                <button
                  onClick={() => handleCopy(feedbackResult, 'feedback')}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'feedback' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'feedback' ? 'Copied' : 'Copy Letter'}
                </button>
              )}
            </div>

            {feedbackResult ? (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans animate-in fade-in duration-200">
                {feedbackResult}
              </div>
            ) : (
              <div className="py-20 text-center text-xs text-slate-500 italic">
                Provide candidates with dignifying, actionable feedback to elevate brand reputation and candidate goodwill.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

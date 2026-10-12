import React, { useState, useEffect } from 'react';
import { 
  AssessmentTemplate, AssessmentSubmission, JobApplicant 
} from '../types';
import { 
  Award, Play, Video, Table, FileText, CheckCircle2, 
  Clock, ShieldCheck, AlertTriangle, Eye, EyeOff, Send, 
  Copy, Check, RefreshCw, X, ChevronRight, BarChart2,
  Sparkles, ExternalLink, HelpCircle, Monitor, Laptop, Star
} from 'lucide-react';

interface CanditechAssessmentSuiteProps {
  applicants: JobApplicant[];
}

export const CanditechAssessmentSuite: React.FC<CanditechAssessmentSuiteProps> = ({
  applicants
}) => {
  const [activeView, setActiveView] = useState<'recruiter' | 'test_taker'>('recruiter');
  const [assessments, setAssessments] = useState<AssessmentTemplate[]>([]);
  const [submissions, setSubmissions] = useState<AssessmentSubmission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<AssessmentSubmission | null>(null);

  // Recruiter Settings
  const [blindGrading, setBlindGrading] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteAssessmentId, setInviteAssessmentId] = useState('ASM-01');
  const [inviteCandidateName, setInviteCandidateName] = useState(applicants[0]?.applicant_name || 'Youssef El-Masry');
  const [inviteCandidateEmail, setInviteCandidateEmail] = useState(applicants[0]?.email_address || 'youssef.elmasry@gmail.com');
  const [inviteCandidatePhone, setInviteCandidatePhone] = useState(applicants[0]?.phone_number || '+201023456789');
  const [inviteResult, setInviteResult] = useState<any>(null);

  // Test Taker State
  const [activeTest, setActiveTest] = useState<AssessmentTemplate | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(1500); // 25 mins
  const [tabSwitches, setTabSwitches] = useState(0);
  const [candidateNameInput, setCandidateNameInput] = useState('Sara Mansour');
  const [candidateEmailInput, setCandidateEmailInput] = useState('sara.mansour@candidate.eg');

  // Candidate task inputs
  const [videoTranscriptInput, setVideoTranscriptInput] = useState(
    "Good evening. On behalf of Jaz Sharm Dreams, I apologize for this unexpected delay with your suite. We have immediately prepared our VIP beachfront cabana with private champagne service for you, and your presidential suite will be expedited with full complimentary resort credit."
  );
  const [writtenAnswerInput, setWrittenAnswerInput] = useState(
    "Dear Regional Director, thank you for reaching out. We have upgraded our seasonal tour operator protocols, guaranteeing dedicated guest relations liaisons and prime beachfront cabana allocations for all your VIP charter guests throughout their stay."
  );
  const [mcqSelectedOption, setMcqSelectedOption] = useState<number | null>(2);
  const [spreadsheetCells, setSpreadsheetCells] = useState<Array<Array<string | number>>>([
    ["Room Category", "Total Keys", "Occupied", "Nightly Rate", "Total Revenue"],
    ["Standard Garden View", "250", "235", "$120", "$28,200"],
    ["Deluxe Sea View", "180", "172", "$180", "$30,960"],
    ["Executive Swim-Up", "80", "78", "$260", "$20,280"],
    ["Royal Beach Suite", "20", "19", "$550", "$10,450"],
    ["TOTAL SUMMARY", "530", "504", "ADR: $178", "$89,890"]
  ]);

  const [isSubmittingTest, setIsSubmittingTest] = useState(false);
  const [testSubmissionSuccess, setTestSubmissionSuccess] = useState<AssessmentSubmission | null>(null);

  // Fetch assessments and submissions
  const fetchAssessmentData = async () => {
    try {
      const [resTemplates, resSubmissions] = await Promise.all([
        fetch('/api/assessments'),
        fetch('/api/assessments-submissions')
      ]);
      const dataT = await resTemplates.json();
      const dataS = await resSubmissions.json();
      if (dataT.assessments) setAssessments(dataT.assessments);
      if (dataS.submissions) setSubmissions(dataS.submissions);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAssessmentData();
  }, []);

  // Timer countdown in test-taker mode
  useEffect(() => {
    if (activeView !== 'test_taker' || timeLeftSeconds <= 0) return;
    const interval = setInterval(() => {
      setTimeLeftSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeView, timeLeftSeconds]);

  // Proctoring simulation: tab switch detection
  useEffect(() => {
    if (activeView !== 'test_taker') return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitches(prev => prev + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeView]);

  const startTestTaker = (template: AssessmentTemplate) => {
    setActiveTest(template);
    setCurrentTaskIndex(0);
    setTimeLeftSeconds(template.duration_minutes * 60);
    setTabSwitches(0);
    setTestSubmissionSuccess(null);
    setActiveView('test_taker');
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/assessments/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_id: inviteAssessmentId,
          candidate_name: inviteCandidateName,
          candidate_email: inviteCandidateEmail,
          candidate_phone: inviteCandidatePhone
        })
      });
      const data = await res.json();
      setInviteResult(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const updated = spreadsheetCells.map((row, r) =>
      row.map((cell, c) => (r === rowIndex && c === colIndex ? value : cell))
    );
    setSpreadsheetCells(updated);
  };

  const handleSubmitCandidateTest = async () => {
    if (!activeTest) return;
    setIsSubmittingTest(true);
    try {
      const res = await fetch(`/api/assessments/${activeTest.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: candidateNameInput,
          candidate_email: candidateEmailInput,
          time_spent_seconds: (activeTest.duration_minutes * 60) - timeLeftSeconds,
          tab_switches: tabSwitches,
          task_responses: {
            video_response_transcript: videoTranscriptInput,
            spreadsheet_results: spreadsheetCells,
            written_response: writtenAnswerInput,
            mcq_selection: mcqSelectedOption
          }
        })
      });
      const data = await res.json();
      if (data.submission) {
        setTestSubmissionSuccess(data.submission);
        setSubmissions(prev => [data.submission, ...prev]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingTest(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-6">
      {/* Canditech Assessment Suite Top Bar */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Award className="w-4 h-4" />
            Canditech Job-Simulation Pre-Employment Testing
          </div>
          <h2 className="text-xl sm:text-3xl font-extrabold text-white tracking-tight">
            Work-Sample Simulations & AI Scorecards
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Assess real job performance before hiring. Multi-modal tests with interactive spreadsheets, video prompts, situational dilemmas, and proctored anti-cheating verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {activeView === 'test_taker' ? (
            <button
              onClick={() => setActiveView('recruiter')}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors"
            >
              Exit Test Taker & Return to Recruiter Desk
            </button>
          ) : (
            <>
              <button
                onClick={() => setBlindGrading(!blindGrading)}
                className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border ${
                  blindGrading
                    ? 'bg-purple-950/70 border-purple-500/50 text-purple-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {blindGrading ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span className="truncate">{blindGrading ? 'Blind: Active' : 'Blind Grading'}</span>
              </button>

              <button
                onClick={() => {
                  setInviteResult(null);
                  setInviteModalOpen(true);
                }}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-amber-950 transition-colors whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                Invite Candidate
              </button>
            </>
          )}
        </div>
      </div>

      {/* VIEW 1: RECRUITER ASSESSMENT WORKSPACE */}
      {activeView === 'recruiter' && (
        <div className="space-y-6">
          {/* Assessment Templates Library */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Laptop className="w-4 h-4 text-amber-400" />
                Job Simulation Test Library ({assessments.length} Active Templates)
              </h3>
              <span className="text-xs text-slate-500">Tailored for Sharm Dreams Group</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {assessments.map(test => (
                <div
                  key={test.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3 flex flex-col justify-between hover:border-amber-500/30 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        {test.difficulty} • {test.duration_minutes} Mins
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {test.tasks_count} Tasks
                      </span>
                    </div>

                    <h4 className="font-bold text-white text-sm sm:text-base mt-2">
                      {test.title}
                    </h4>
                    <div className="text-xs text-slate-400 mt-1">
                      Target Role: <b className="text-amber-400 font-normal">{test.role}</b>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-3">
                      {test.skills_tested.slice(0, 3).map(skill => (
                        <span key={skill} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-cyan-300">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">{test.company.split('(')[0]}</span>
                    <button
                      onClick={() => startTestTaker(test)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 font-bold text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      Take Test Drive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completed Submissions & Canditech Scorecards Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-amber-400" />
                  Candidate Performance Scorecards & Proctored Results
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  AI-evaluated work samples with anti-cheating audit, percentile ranking, and section rubrics.
                </p>
              </div>

              <span className="text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded-xl">
                {submissions.length} Completed Scorecards
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-semibold tracking-wider">
                  <tr>
                    <th className="p-3">Candidate</th>
                    <th className="p-3">Simulation Assessment</th>
                    <th className="p-3">Overall Score</th>
                    <th className="p-3">Percentile</th>
                    <th className="p-3">Hiring Verdict</th>
                    <th className="p-3">Proctoring Audit</th>
                    <th className="p-3 text-right">Scorecard</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {submissions.map(sub => {
                    const isStrong = sub.overall_score >= 90;
                    return (
                      <tr key={sub.id} className="hover:bg-slate-850/50">
                        <td className="p-3 font-semibold text-white">
                          {blindGrading ? `Candidate #${sub.id.slice(-4)} (Anonymized)` : sub.candidate_name}
                        </td>
                        <td className="p-3 text-slate-400 truncate max-w-xs">{sub.assessment_title}</td>
                        <td className="p-3">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-xs ${
                            isStrong ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {sub.overall_score}%
                          </span>
                        </td>
                        <td className="p-3 font-mono text-cyan-300">Top {100 - sub.percentile}%</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            sub.recommendation === 'Strong Hire' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-amber-300'
                          }`}>
                            {sub.recommendation}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {sub.proctoring.integrity_score}% Clean ({sub.proctoring.tab_switches} switches)
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => setSelectedSubmission(sub)}
                            className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 font-bold text-xs transition-colors"
                          >
                            View Scorecard
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LIVE CANDIDATE JOB SIMULATION TEST TAKER */}
      {activeView === 'test_taker' && activeTest && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col space-y-0 animate-in fade-in duration-200">
          {/* Test Taker Header */}
          <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center font-bold text-slate-950">
                <Laptop className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white">{activeTest.title}</h3>
                <div className="text-xs text-slate-400">
                  Candidate: <b>{candidateNameInput}</b> ({candidateEmailInput})
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Countdown Timer */}
              <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-amber-400 font-mono font-bold text-sm">
                <Clock className="w-4 h-4" />
                <span>{formatTime(timeLeftSeconds)} Remaining</span>
              </div>

              {/* Proctoring Shield */}
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Proctoring Active ({tabSwitches} switches)</span>
              </div>
            </div>
          </div>

          {/* Task Stepper Tabs */}
          <div className="px-6 py-2.5 bg-slate-900 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto">
            {activeTest.tasks.map((task, idx) => (
              <button
                key={task.id}
                onClick={() => setCurrentTaskIndex(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  currentTaskIndex === idx
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-950'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {task.type === 'video' && <Video className="w-3.5 h-3.5" />}
                {task.type === 'spreadsheet' && <Table className="w-3.5 h-3.5" />}
                {task.type === 'written' && <FileText className="w-3.5 h-3.5" />}
                {task.type === 'mcq' && <CheckCircle2 className="w-3.5 h-3.5" />}
                Task {idx + 1}: {task.title.split('(')[0]}
              </button>
            ))}
          </div>

          {/* Task Work Environment */}
          <div className="p-6 space-y-6">
            {/* Task Prompt Box */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-amber-400 uppercase tracking-wider">
                  Task #{currentTaskIndex + 1}: {activeTest.tasks[currentTaskIndex].title}
                </span>
                <span className="text-slate-500 font-mono">
                  Suggested Time: {activeTest.tasks[currentTaskIndex].time_limit_minutes} minutes
                </span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed font-sans font-medium">
                {activeTest.tasks[currentTaskIndex].prompt}
              </p>
            </div>

            {/* Task 1: Video Response Simulator */}
            {activeTest.tasks[currentTaskIndex].type === 'video' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                <div className="md:col-span-5 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-center space-y-3 relative overflow-hidden">
                  <div className="h-48 bg-slate-900 rounded-xl flex flex-col items-center justify-center border border-slate-800 relative">
                    <Video className="w-10 h-10 text-emerald-400 animate-pulse" />
                    <span className="text-xs text-emerald-400 font-medium mt-2">
                      Webcam Stream Connected (1080p HD)
                    </span>
                    <span className="absolute bottom-2 left-3 text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      REC 01:42 / 02:00
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Microphone & Webcam calibrated. AI analyzes speech structure, clarity, and language fluency.
                  </div>
                </div>

                <div className="md:col-span-7 space-y-2">
                  <label className="text-xs text-slate-400 block font-medium">
                    Speech-to-Text Live Transcript (Auto-generated by Canditech AI Audio Stream):
                  </label>
                  <textarea
                    rows={6}
                    value={videoTranscriptInput}
                    onChange={(e) => setVideoTranscriptInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-xs leading-relaxed outline-none focus:ring-1 focus:ring-amber-500 font-sans"
                  />
                </div>
              </div>
            )}

            {/* Task 2: Live Interactive Spreadsheet */}
            {activeTest.tasks[currentTaskIndex].type === 'spreadsheet' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Live Canditech Spreadsheet Engine (Click any cell to edit or compute formulas):
                  </span>
                  <span className="text-emerald-400 font-mono text-[11px]">Auto-saved locally</span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950">
                  <table className="w-full text-left text-xs font-mono">
                    <tbody>
                      {spreadsheetCells.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className={rIdx === 0 ? "bg-slate-900 font-bold text-amber-300" : "border-t border-slate-800/80"}
                        >
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="p-2 border-r border-slate-800/60 min-w-32">
                              {rIdx === 0 ? (
                                <span className="text-slate-200">{cell}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={cell}
                                  onChange={(e) => handleCellChange(rIdx, cIdx, e.target.value)}
                                  className="w-full bg-transparent text-white outline-none focus:bg-slate-900 px-1 rounded"
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Task 3: Written Response */}
            {activeTest.tasks[currentTaskIndex].type === 'written' && (
              <div className="space-y-2">
                <label className="text-xs text-slate-400 block font-medium">
                  Executive Written Response Editor:
                </label>
                <textarea
                  rows={8}
                  value={writtenAnswerInput}
                  onChange={(e) => setWrittenAnswerInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-xs leading-relaxed outline-none focus:ring-1 focus:ring-amber-500 font-sans"
                />
              </div>
            )}

            {/* Task 4: Situational Judgment MCQ */}
            {activeTest.tasks[currentTaskIndex].type === 'mcq' && (
              <div className="space-y-3">
                <label className="text-xs text-slate-400 block font-medium">
                  Select your operational decision:
                </label>
                <div className="space-y-2">
                  {activeTest.tasks[currentTaskIndex].options?.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => setMcqSelectedOption(optIdx)}
                      className={`w-full text-left p-4 rounded-xl border transition-all text-xs flex items-center gap-3 ${
                        mcqSelectedOption === optIdx
                          ? 'bg-amber-500/20 border-amber-500 text-white font-medium'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-850'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        mcqSelectedOption === optIdx ? 'border-amber-400 bg-amber-400 text-slate-950 font-bold' : 'border-slate-600'
                      }`}>
                        {mcqSelectedOption === optIdx ? '✓' : ''}
                      </div>
                      <span>{opt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Test Taker Action Bar */}
          <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {currentTaskIndex > 0 && (
                <button
                  onClick={() => setCurrentTaskIndex(prev => prev - 1)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Previous Task
                </button>
              )}
              {currentTaskIndex < activeTest.tasks.length - 1 && (
                <button
                  onClick={() => setCurrentTaskIndex(prev => prev + 1)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
                >
                  Next Task &rarr;
                </button>
              )}
            </div>

            <button
              onClick={handleSubmitCandidateTest}
              disabled={isSubmittingTest}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-emerald-950 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSubmittingTest ? 'Grading with AI...' : 'Submit Assessment for AI Evaluation'}
            </button>
          </div>

          {/* Submission Result Modal Preview */}
          {testSubmissionSuccess && (
            <div className="p-6 bg-emerald-950/40 border-t border-emerald-500/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                  <CheckCircle2 className="w-5 h-5" />
                  Canditech Assessment Completed & Graded!
                </div>
                <button
                  onClick={() => {
                    setSelectedSubmission(testSubmissionSuccess);
                    setActiveView('recruiter');
                  }}
                  className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  View Generated Scorecard
                </button>
              </div>
              <p className="text-xs text-slate-300">
                Score: <b>{testSubmissionSuccess.overall_score}%</b> (Top {100 - testSubmissionSuccess.percentile}% Percentile) • Recommendation: <b>{testSubmissionSuccess.recommendation}</b>
              </p>
            </div>
          )}
        </div>
      )}

      {/* FULL CANDIDATE SCORECARD MODAL */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl space-y-5 sm:space-y-6 max-h-[95vh] sm:max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            {/* Scorecard Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-xs font-mono text-slate-400">{selectedSubmission.id}</span>
                <h3 className="text-2xl font-bold text-white">
                  {blindGrading ? `Candidate #${selectedSubmission.id.slice(-4)} (Blind Review)` : selectedSubmission.candidate_name}
                </h3>
                <div className="text-xs text-amber-400 mt-0.5">{selectedSubmission.assessment_title}</div>
              </div>
              <button onClick={() => setSelectedSubmission(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scorecard Summary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Overall Score</div>
                <div className="text-3xl font-extrabold text-emerald-400 mt-1">{selectedSubmission.overall_score}%</div>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Percentile</div>
                <div className="text-3xl font-extrabold text-cyan-400 mt-1">Top {100 - selectedSubmission.percentile}%</div>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Hiring Verdict</div>
                <div className="text-xl font-bold text-white mt-2">{selectedSubmission.recommendation}</div>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Proctoring Integrity</div>
                <div className="text-xl font-bold text-emerald-400 mt-2">{selectedSubmission.proctoring.integrity_score}% Clean</div>
              </div>
            </div>

            {/* Section Breakdown Rubrics */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Section Rubrics Breakdown
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-400">Role Competency</span>
                    <span className="text-emerald-400 font-bold">{selectedSubmission.section_scores.role_competency}%</span>
                  </div>
                  <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${selectedSubmission.section_scores.role_competency}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-400">Problem Solving</span>
                    <span className="text-cyan-400 font-bold">{selectedSubmission.section_scores.problem_solving}%</span>
                  </div>
                  <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-400" style={{ width: `${selectedSubmission.section_scores.problem_solving}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-400">Communication</span>
                    <span className="text-amber-400 font-bold">{selectedSubmission.section_scores.communication}%</span>
                  </div>
                  <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${selectedSubmission.section_scores.communication}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-400">Integrity & Culture</span>
                    <span className="text-purple-400 font-bold">{selectedSubmission.section_scores.integrity_culture}%</span>
                  </div>
                  <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-400" style={{ width: `${selectedSubmission.section_scores.integrity_culture}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* AI Evaluation Critique */}
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1.5 text-xs">
              <span className="font-bold text-amber-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                Canditech AI Evaluator Synthesis:
              </span>
              <p className="text-slate-300 leading-relaxed font-sans">
                {selectedSubmission.ai_feedback}
              </p>
            </div>

            {/* Work Sample Inspect View */}
            <div className="space-y-3 text-xs">
              <span className="font-bold text-slate-300 block">Candidate Submitted Work Sample Answers:</span>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto">
                <pre>{JSON.stringify(selectedSubmission.task_responses, null, 2)}</pre>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedSubmission(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs"
              >
                Close Scorecard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INVITE CANDIDATE MODAL */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-400" />
                Dispatch Canditech Job Simulation Invite
              </h3>
              <button onClick={() => setInviteModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-3 text-xs animate-in fade-in duration-200">
                <div className="p-3.5 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200">
                  {inviteResult.message}
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px] text-slate-300">
                  <b>Test Link:</b> {inviteResult.test_link}
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-emerald-400 text-[11px]">
                  {inviteResult.whatsapp_dispatch}
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendInvite} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Select Simulation Assessment</label>
                  <select
                    value={inviteAssessmentId}
                    onChange={(e) => setInviteAssessmentId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {assessments.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.title} ({a.duration_minutes}m)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Candidate Name</label>
                  <input
                    type="text"
                    required
                    value={inviteCandidateName}
                    onChange={(e) => setInviteCandidateName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Candidate Email</label>
                  <input
                    type="email"
                    required
                    value={inviteCandidateEmail}
                    onChange={(e) => setInviteCandidateEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Candidate WhatsApp Mobile (+20 Egypt)</label>
                  <input
                    type="tel"
                    required
                    value={inviteCandidatePhone}
                    onChange={(e) => setInviteCandidatePhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                  >
                    Dispatch Test Invite
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

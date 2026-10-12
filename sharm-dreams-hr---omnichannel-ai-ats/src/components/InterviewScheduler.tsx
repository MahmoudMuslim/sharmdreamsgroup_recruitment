import React, { useState } from 'react';
import { JobApplicant, InterviewSchedule } from '../types';
import { 
  Calendar, Clock, Video, Users, CheckCircle2, 
  Send, Plus, MessageCircle, AlertCircle, Sparkles, ExternalLink
} from 'lucide-react';

interface InterviewSchedulerProps {
  applicants: JobApplicant[];
  onScheduleInterview: (applicantId: string, interviewData: any) => Promise<void>;
}

export const InterviewScheduler: React.FC<InterviewSchedulerProps> = ({
  applicants,
  onScheduleInterview
}) => {
  const [selectedApplicantId, setSelectedApplicantId] = useState<string>(applicants[0]?.id || '');
  const [roundName, setRoundName] = useState('Technical & Cultural Alignment');
  const [interviewerName, setInterviewerName] = useState('Tamer Roushdy');
  const [interviewerRole, setInterviewerRole] = useState('Hospitality Operations Director');
  const [scheduledDateTime, setScheduledDateTime] = useState('2026-10-15T11:00');
  const [platform, setPlatform] = useState<'Google Meet' | 'Microsoft Teams' | 'On-Site' | 'WhatsApp Video'>('Google Meet');
  const [meetingLink, setMeetingLink] = useState('https://meet.google.com/sdg-talent-interview');
  const [isScheduling, setIsScheduling] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedApplicant = applicants.find(a => a.id === selectedApplicantId);

  // Flatten all interviews across all candidates for the schedule feed
  const allInterviews: Array<{ applicant: JobApplicant; interview: InterviewSchedule }> = [];
  applicants.forEach(app => {
    (app.interviews || []).forEach(int => {
      allInterviews.push({ applicant: app, interview: int });
    });
  });

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApplicantId) return;
    setIsScheduling(true);
    setSuccessMessage(null);
    try {
      await onScheduleInterview(selectedApplicantId, {
        round_name: roundName,
        interviewer_name: interviewerName,
        interviewer_role: interviewerRole,
        scheduled_datetime: scheduledDateTime,
        location_or_link: meetingLink,
        platform: platform
      });
      setSuccessMessage(`Interview confirmed for ${selectedApplicant?.applicant_name}! Automated calendar invite and WhatsApp template dispatched.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Calendar className="w-4 h-4" />
            AI Automated Interview Scheduling & Coordination
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            Interview Coordination & Multi-Panel Dispatch
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Eliminate scheduling back-and-forth. Coordinate multi-panel interviews, auto-generate Google Meet / Teams links, and dispatch instant WhatsApp reminders with calendar sync.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold">
            {allInterviews.length} Scheduled Sessions
          </span>
        </div>
      </div>

      {/* Grid: Booking Form & Upcoming Schedule Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Schedule Form */}
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-amber-400" />
            Coordinate New Interview Session
          </h3>

          {successMessage && (
            <div className="p-3.5 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleScheduleSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="text-slate-300 block mb-1 font-medium">Select Candidate</label>
              <select
                value={selectedApplicantId}
                onChange={(e) => setSelectedApplicantId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs"
              >
                {applicants.map(app => (
                  <option key={app.id} value={app.id}>
                    {app.applicant_name} — {app.job_title} ({app.company})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Interview Round</label>
                <input
                  type="text"
                  value={roundName}
                  onChange={(e) => setRoundName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                >
                  <option value="Google Meet">Google Meet</option>
                  <option value="Microsoft Teams">Microsoft Teams</option>
                  <option value="On-Site">On-Site (Resort / Cairo HQ)</option>
                  <option value="WhatsApp Video">WhatsApp Video</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Interviewer Name</label>
                <input
                  type="text"
                  value={interviewerName}
                  onChange={(e) => setInterviewerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Interviewer Role</label>
                <input
                  type="text"
                  value={interviewerRole}
                  onChange={(e) => setInterviewerRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Meeting URL / Room</label>
                <input
                  type="text"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500 font-mono text-[11px]"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <MessageCircle className="w-3.5 h-3.5" />
                Automated WhatsApp Dispatch Preview
              </div>
              <div>"Dear {selectedApplicant?.applicant_name || 'Candidate'}, you are scheduled for {roundName} with {interviewerName} on {scheduledDateTime.replace('T', ' at ')}..."</div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isScheduling}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-950 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                {isScheduling ? 'Dispatching...' : 'Confirm & Dispatch Invite'}
              </button>
            </div>
          </form>
        </div>

        {/* Right: Active Schedule Feed */}
        <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" />
              Active Interview Pipeline Calendar
            </h3>
            <span className="text-xs text-slate-500">{allInterviews.length} sessions booked</span>
          </div>

          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {allInterviews.map(({ applicant, interview }) => (
              <div
                key={interview.id}
                className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 hover:border-amber-500/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white text-xs sm:text-sm">{applicant.applicant_name}</h4>
                    <div className="text-[11px] text-amber-400 font-medium">{interview.round_name}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                    {interview.platform}
                  </span>
                </div>

                <div className="text-xs text-slate-300 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span>Interviewer: <b>{interview.interviewer_name}</b> ({interview.interviewer_role})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>{new Date(interview.scheduled_datetime).toLocaleString()}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-500">{applicant.company}</span>
                  <a
                    href={interview.location_or_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-[11px] font-medium"
                  >
                    Join Meeting
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}

            {allInterviews.length === 0 && (
              <div className="py-12 text-center text-xs text-slate-500 italic">
                No interviews scheduled yet. Select a candidate on the left to schedule an interview.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

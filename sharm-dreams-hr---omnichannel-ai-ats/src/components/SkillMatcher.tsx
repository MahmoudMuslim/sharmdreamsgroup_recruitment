import React, { useState } from 'react';
import { JobApplicant, JobPosition } from '../types';
import { 
  Sparkles, Award, CheckCircle2, AlertTriangle, 
  ChevronRight, Search, Filter, ShieldCheck, Heart, 
  ArrowRight, Layers, Sliders
} from 'lucide-react';

interface SkillMatcherProps {
  applicants: JobApplicant[];
  jobs: JobPosition[];
  onSelectApplicant: (applicant: JobApplicant) => void;
}

export const SkillMatcher: React.FC<SkillMatcherProps> = ({
  applicants,
  jobs,
  onSelectApplicant
}) => {
  const [selectedJobId, setSelectedJobId] = useState<string>(jobs[0]?.id || '');
  const [biasReductionEnabled, setBiasReductionEnabled] = useState(true);
  const [skillWeight, setSkillWeight] = useState(50); // 0-100%
  const [culturalWeight, setCulturalWeight] = useState(50); // 0-100%

  const selectedJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  // Rank applicants based on dynamic weights
  const rankedApplicants = [...applicants].map(applicant => {
    const skillScore = applicant.skill_match_score || 80;
    const cultScore = applicant.cultural_fit_score || 82;
    const weightedTotal = Math.round(
      (skillScore * (skillWeight / 100)) + 
      (cultScore * (culturalWeight / 100))
    );
    return {
      applicant,
      skillScore,
      cultScore,
      weightedTotal
    };
  }).sort((a, b) => b.weightedTotal - a.weightedTotal);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Award className="w-4 h-4" />
            AI Multi-Dimensional Match Engine
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            Skill Competency & Cultural Fit Matching
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Rank candidates using balanced weighted scoring across hard skills, European language fluency, and corporate cultural values while enforcing algorithmic bias mitigation.
          </p>
        </div>

        {/* Bias Reduction Toggle */}
        <div className="flex items-center gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800 shrink-0 text-xs">
          <ShieldCheck className={`w-5 h-5 ${biasReductionEnabled ? 'text-emerald-400' : 'text-slate-500'}`} />
          <div>
            <div className="font-bold text-white">Bias-Reduction Mode</div>
            <div className="text-[10px] text-slate-400">Anonymizes demographic factors</div>
          </div>
          <button
            onClick={() => setBiasReductionEnabled(!biasReductionEnabled)}
            className={`w-10 h-5 rounded-full transition-colors relative ml-2 ${
              biasReductionEnabled ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                biasReductionEnabled ? 'left-5.5' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Target Job Selector & Weight Sliders */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-1.5">
              Target Position for Benchmark
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white outline-none focus:ring-1 focus:ring-amber-500"
            >
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.title} — {j.company}
                </option>
              ))}
            </select>
          </div>

          {/* Sliders */}
          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="text-cyan-400">Hard Skill Match Weight</span>
                <span className="text-white font-mono">{skillWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={skillWeight}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSkillWeight(val);
                  setCulturalWeight(100 - val);
                }}
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex justify-between font-semibold">
                <span className="text-amber-400">Cultural & Values Fit Weight</span>
                <span className="text-white font-mono">{culturalWeight}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={culturalWeight}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCulturalWeight(val);
                  setSkillWeight(100 - val);
                }}
                className="w-full accent-amber-400"
              />
            </div>
          </div>
        </div>

        {/* Selected Job Core Requirements */}
        {selectedJob && (
          <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-400 font-medium">Core Required Competencies:</span>
            {selectedJob.required_skills.map(s => (
              <span key={s} className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[11px]">
                {s}
              </span>
            ))}
            <span className="text-slate-400 font-medium ml-2">Cultural Pillars:</span>
            {selectedJob.cultural_values.map(v => (
              <span key={v} className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                {v}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Ranked Candidate Results */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>Ranked by Weighted Fit ({skillWeight}% Skill + {culturalWeight}% Culture)</span>
          <span>{rankedApplicants.length} Evaluated Profiles</span>
        </div>

        {rankedApplicants.map(({ applicant, skillScore, cultScore, weightedTotal }, index) => {
          const radar = applicant.radar_scores || { technical: 85, domain: 88, cultural: 84, leadership: 80, adaptability: 86 };

          return (
            <div
              key={applicant.id}
              onClick={() => onSelectApplicant(applicant)}
              className="bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 cursor-pointer transition-all shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl font-bold text-sm flex items-center justify-center shrink-0 border ${
                  index === 0
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-md shadow-amber-950'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}>
                  #{index + 1}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base hover:text-amber-300 transition-colors">
                      {biasReductionEnabled ? applicant.applicant_name : `${applicant.applicant_name} (Anonymized Mode)`}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-400">
                      {applicant.id}
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 mt-0.5">
                    Applied for: <b className="text-amber-400 font-normal">{applicant.job_title}</b> • {applicant.company}
                  </div>

                  {/* Matched skills pill preview */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {(applicant.matched_skills || []).slice(0, 3).map(skill => (
                      <span key={skill} className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px]">
                        ✓ {skill}
                      </span>
                    ))}
                    {(applicant.missing_skills || []).slice(0, 1).map(skill => (
                      <span key={skill} className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]">
                        ⚠ Gap: {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Score Gauges Row */}
              <div className="flex items-center gap-5 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
                <div className="text-center">
                  <div className="text-[10px] uppercase font-semibold text-cyan-400">Skill Fit</div>
                  <div className="text-lg font-extrabold text-cyan-400">{skillScore}%</div>
                </div>

                <div className="text-center">
                  <div className="text-[10px] uppercase font-semibold text-amber-400">Culture Fit</div>
                  <div className="text-lg font-extrabold text-amber-400">{cultScore}%</div>
                </div>

                <div className="text-center bg-slate-950 p-2.5 rounded-xl border border-slate-800 min-w-24">
                  <div className="text-[10px] uppercase font-bold text-emerald-400">Weighted Match</div>
                  <div className="text-2xl font-black text-emerald-400">{weightedTotal}%</div>
                </div>

                <ChevronRight className="w-5 h-5 text-slate-500 shrink-0 hidden md:block" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

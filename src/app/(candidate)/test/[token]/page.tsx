import { Suspense } from "react";
import { AssessmentRunner } from "@/modules/assessment/presentation/AssessmentRunner";

export const metadata = {
  title: "Candidate assessment",
  description: "Secure time-limited assessment runner",
};

export default function AssessmentRunnerPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-brand-ivory px-4 text-brand-ink/50">
          <div className="text-center">
            <p className="text-sm font-semibold">Preparing your secure assessment…</p>
            <p className="mt-1 text-xs text-brand-ink/40">Please do not close this window.</p>
          </div>
        </main>
      }
    >
      <AssessmentRunner />
    </Suspense>
  );
}
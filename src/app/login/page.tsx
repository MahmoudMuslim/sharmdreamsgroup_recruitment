import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Recruiter sign-in",
  description: "Secure OAuth 2.0 and password access for Sharm Dreams Talent Cloud staff",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
          Loading sign-in…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
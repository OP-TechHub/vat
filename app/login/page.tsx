import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · VAT Input Claims Register" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm flex flex-col gap-5">
        <div>
          <h1 className="text-[22px] font-semibold m-0">VAT Input Claims Register</h1>
          <p className="note mt-1">Sign in with your email and password.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

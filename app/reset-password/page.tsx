import ResetPasswordForm from "./ResetPasswordForm";

export const metadata = { title: "Set a new password · VAT Input Claims Register" };

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm flex flex-col gap-5">
        <div>
          <h1 className="text-[22px] font-semibold m-0">Set a new password</h1>
          <p className="note mt-1">Choose a new password for your account.</p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}

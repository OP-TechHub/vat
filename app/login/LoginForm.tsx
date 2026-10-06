"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function goIn() {
    const next = params.get("next");
    router.replace(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const supabase = createClient();

    if (mode === "signup") {
      if (password.length < 8) return setError("Use a password of at least 8 characters.");
      if (password !== confirm) return setError("The two passwords do not match.");
      setBusy(true);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin + "/login" },
      });
      setBusy(false);
      if (error) return setError(error.message);
      if (data.session) return goIn(); // email confirmation is off: signed in straight away
      setInfo(
        "Account created. Check your email for a confirmation link, then sign in. " +
          "A company admin must add your email on the Members tab before you can see any data.",
      );
      setMode("signin");
      setPassword("");
      setConfirm("");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    goIn();
  }

  return (
    <form onSubmit={onSubmit} className="panel gap-3">
      <div className="flex gap-1 border-b border-line -mx-3.5 px-3.5" role="tablist">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            className="tab"
            aria-current={mode === m ? "page" : undefined}
            onClick={() => {
              setMode(m);
              setError(null);
              setInfo(null);
            }}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <label className="field">
        Email
        <input
          className="control"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        Password
        <input
          className="control"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {mode === "signup" && (
        <label className="field">
          Confirm password
          <input
            className="control"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}
      {error && <div className="msg msg-err">{error}</div>}
      {info && <div className="msg">{info}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? (mode === "signup" ? "Creating…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {mode === "signup" && (
        <div className="note">
          Creating an account does not give access to any company. A company admin adds your email on the Members tab.
        </div>
      )}
    </form>
  );
}

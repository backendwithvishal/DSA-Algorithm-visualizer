import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Zap, AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { apiClient, ApiError } from "../../lib/apiClient";

const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter",  test: (p: string) => /[A-Z]/.test(p) },
  { label: "One number",            test: (p: string) => /\d/.test(p) },
];

type State = "idle" | "loading" | "success" | "error" | "invalid";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  // Extract token + email from URL — e.g. /reset-password?token=abc&email=user@example.com
  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  const [password,    setPassword]    = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [state,       setState]       = useState<State>("idle");
  const [errorMsg,    setErrorMsg]    = useState("");

  const passwordStrength = PASSWORD_RULES.filter(r => r.test(password)).length;
  const passwordsMatch   = password === confirmPw && confirmPw.length > 0;

  // Guard: if token or email are missing, show invalid link state immediately
  useEffect(() => {
    if (!token || !email) setState("invalid");
  }, [token, email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordStrength < 3 || !passwordsMatch) return;

    setState("loading");
    setErrorMsg("");

    try {
      await apiClient.post("/auth/reset-password", { token, email, password });
      setState("success");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please request a new reset link.";
      setErrorMsg(message);
      setState("error");
    }
  }

  // ── Invalid link UI ────────────────────────────────────────────────
  if (state === "invalid") {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-rose-500" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Invalid Reset Link</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              This password reset link is invalid or missing required parameters. Please request a new one.
            </p>
            <Link to="/forgot-password">
              <Button variant="primary" className="w-full">Request New Link</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Success UI ─────────────────────────────────────────────────────
  if (state === "success") {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Password Reset!</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              Your password has been changed successfully. All active sessions have been signed out for your security.
            </p>
            <Button
              id="goto-login"
              variant="primary"
              className="w-full"
              onClick={() => navigate("/login")}
            >
              Sign In with New Password
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form UI ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
            <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-extrabold text-lg text-zinc-900 dark:text-white">
            Algo<span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">Viz</span> Pro
          </span>
        </Link>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 mb-4">
            <ShieldCheck className="w-6 h-6 text-indigo-500" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-1">Set new password</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
            Choose a strong password for <strong className="text-zinc-700 dark:text-zinc-200">{email}</strong>
          </p>

          {state === "error" && (
            <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 rounded-xl p-3 mb-4">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-rose-600 dark:text-rose-400">{errorMsg}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* New Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                New Password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPw ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={state === "loading"}
                  className="w-full rounded-[10px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 px-3 py-3 sm:py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all disabled:opacity-60"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  onClick={() => setShowPw(p => !p)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Strength bar */}
              {password && (
                <div className="flex gap-1 mt-1">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className={`flex-1 h-1 rounded-full transition-colors duration-300 ${
                        i < passwordStrength
                          ? passwordStrength === 1 ? "bg-rose-400" : passwordStrength === 2 ? "bg-amber-400" : "bg-emerald-400"
                          : "bg-zinc-200 dark:bg-zinc-700"
                      }`}
                    />
                  ))}
                </div>
              )}

              {/* Rules */}
              {password && (
                <div className="space-y-1 mt-1">
                  {PASSWORD_RULES.map(r => (
                    <div key={r.label} className="flex items-center gap-1.5">
                      <CheckCircle2 className={`w-3 h-3 ${r.test(password) ? "text-emerald-500" : "text-zinc-300 dark:text-zinc-700"}`} />
                      <span className={`text-[11px] ${r.test(password) ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
                        {r.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repeat your password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={state === "loading"}
                  className={`w-full rounded-[10px] border bg-white dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 px-3 py-3 sm:py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 transition-all disabled:opacity-60 ${
                    confirmPw
                      ? passwordsMatch
                        ? "border-emerald-400 focus:ring-emerald-500/30 focus:border-emerald-400"
                        : "border-rose-400 focus:ring-rose-500/30 focus:border-rose-400"
                      : "border-zinc-200 dark:border-zinc-700 focus:ring-indigo-500/30 focus:border-indigo-400"
                  }`}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  onClick={() => setShowConfirm(p => !p)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPw && !passwordsMatch && (
                <p className="text-[11px] text-rose-500 mt-0.5">Passwords do not match</p>
              )}
              {confirmPw && passwordsMatch && (
                <p className="text-[11px] text-emerald-500 mt-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>

            <Button
              id="reset-password-submit"
              type="submit"
              variant="primary"
              className="w-full"
              loading={state === "loading"}
              disabled={passwordStrength < 3 || !passwordsMatch || state === "loading"}
            >
              Reset Password
            </Button>
          </form>

          <Link
            to="/login"
            className="flex items-center justify-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-indigo-500 transition-colors mt-5"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

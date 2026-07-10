import { useState } from "react";
import { api } from "../lib/api";
import { ErrorNote } from "./ui";
import { IkidLogo } from "./Logo";
import { PasswordInput } from "./PasswordInput";

/** Public account creation: makes a fresh profile with its own password. */
export function SignupScreen() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/signup", { name: name.trim(), password });
      location.hash = "#/";
      location.reload();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={signup} className="card w-full max-w-sm space-y-4 !p-6">
        <div className="flex flex-col items-center text-center">
          <a href="#/welcome" title="Back to the welcome page" className="transition-opacity hover:opacity-70">
            <IkidLogo height={40} />
          </a>
          <p className="mt-2 text-xs uppercase tracking-widest text-slate-400">create your account</p>
        </div>
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label">Your name</label>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="dawit"
            autoFocus
          />
          <p className="mt-1 text-xs text-slate-400">Becomes your own private database — nobody else can see it.</p>
        </div>
        <div>
          <label className="label">Password</label>
          <PasswordInput value={password} onChange={setPassword} />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <PasswordInput value={confirm} onChange={setConfirm} />
        </div>
        <button
          className="btn-primary w-full justify-center"
          type="submit"
          disabled={busy || !name.trim() || password.length < 4}
        >
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="text-center text-xs">
          <a href="#/" className="text-brand-600 hover:underline">Already have an account? Sign in →</a>
        </p>
      </form>
    </div>
  );
}

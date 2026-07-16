import { useState } from "react";
import { api } from "../lib/api";
import { ErrorNote } from "./ui";
import { IkidLogo } from "./Logo";
import { PasswordInput } from "./PasswordInput";

export interface AuthStatus {
  enabled: boolean;
  current: string | null;
  signedIn: boolean;
  profiles: { name: string; id?: string; protected: boolean }[];
  role?: "admin" | "user" | null;
  isAdmin?: boolean;
  allowSignups?: boolean;
}

export function LoginScreen({ status, onSignedIn }: { status: AuthStatus; onSignedIn: () => void }) {
  const [profile, setProfile] = useState(status.profiles[0]?.name ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = status.profiles.find((p) => p.name === profile);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { profile, password });
      onSignedIn();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={login} className="card w-full max-w-sm space-y-4 !p-6">
        <div className="flex flex-col items-center text-center">
          <a href="#/welcome" title="Back to the welcome page" className="transition-opacity hover:opacity-70">
            <IkidLogo height={40} />
          </a>
          <p className="mt-2 text-xs uppercase tracking-widest text-slate-400">local finance · sign in</p>
        </div>
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label">Who's using Ikid?</label>
          <select
            className="input w-full"
            value={profile}
            onChange={(e) => { setProfile(e.target.value); setPassword(""); setError(null); }}
          >
            {status.profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} {p.protected ? "🔒" : ""}
              </option>
            ))}
          </select>
        </div>
        {selected?.protected ? (
          <div>
            <label className="label">Password</label>
            <PasswordInput value={password} onChange={setPassword} autoFocus />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            This profile has no password yet — you can set one in Settings → Security after signing in.
          </p>
        )}
        <button className="btn-primary w-full justify-center" type="submit" disabled={busy || !profile}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-[11px] text-slate-400">
          Everything stays on this computer. Each user's data lives in a separate database.
        </p>
        <p className="text-center text-xs">
          <a href="#/signup" className="text-brand-600 hover:underline">New here? Sign up →</a>
          <span className="mx-2 text-slate-300">·</span>
          <a href="#/welcome" className="text-brand-600 hover:underline">What is Ikid?</a>
        </p>
      </form>
    </div>
  );
}

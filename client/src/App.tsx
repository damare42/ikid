import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { setCurrency } from "./lib/format";
import type { SettingsDTO } from "@shared/types";
import { ImportDialog } from "./components/ImportDialog";
import { LoginScreen, type AuthStatus } from "./components/LoginScreen";
import { SignupScreen } from "./components/SignupScreen";
import { IkidLogo } from "./components/Logo";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Budgets from "./pages/Budgets";
import Goals from "./pages/Goals";
import Planner from "./pages/Planner";
import Analytics from "./pages/Analytics";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

interface ProfilesInfo {
  active: string;
  profiles: { name: string; active: boolean; size: number }[];
}

function ProfileSwitcher({ auth }: { auth: AuthStatus | null }) {
  const [info, setInfo] = useState<ProfilesInfo | null>(null);

  useEffect(() => {
    api.get<ProfilesInfo>("/api/profiles").then(setInfo).catch(() => {});
  }, []);

  // Accounts mode: no free switching — show who's signed in + sign out.
  if (auth?.enabled) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
        <span className="text-sm font-medium">👤 {auth.current}</span>
        <button
          className="text-xs text-slate-500 hover:text-rose-500"
          onClick={async () => {
            await api.post("/api/auth/logout").catch(() => {});
            location.reload();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  async function onChange(value: string) {
    if (value === "__new__") {
      const name = prompt("New profile name (e.g. partner, business):");
      if (!name?.trim()) return;
      try {
        const created = await api.post<{ name: string }>("/api/profiles", { name: name.trim() });
        await api.post("/api/profiles/activate", { name: created.name });
        location.reload();
      } catch (e: any) {
        alert(e.message);
      }
      return;
    }
    if (info && value !== info.active) {
      try {
        await api.post("/api/profiles/activate", { name: value });
        location.reload();
      } catch (e: any) {
        alert(e.message);
      }
    }
  }

  if (!info) return null;
  return (
    <div className="mb-4 px-1">
      <label className="label px-1">Profile</label>
      <select
        className="input w-full"
        value={info.active}
        onChange={(e) => onChange(e.target.value)}
        title="Each profile is a fully separate database"
      >
        {info.profiles.map((p) => (
          <option key={p.name} value={p.name}>👤 {p.name}</option>
        ))}
        <option value="__new__">＋ New profile…</option>
      </select>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/transactions", label: "Transactions", icon: "🧾" },
  { to: "/budgets", label: "Budgets", icon: "🎯" },
  { to: "/goals", label: "Goals", icon: "🏁" },
  { to: "/planner", label: "Planner", icon: "🧮" },
  { to: "/analytics", label: "Analytics", icon: "📈" },
  { to: "/reports", label: "Reports", icon: "📄" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

function applyTheme(theme: string) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function Shell({ auth }: { auth: AuthStatus | null }) {
  const [importOpen, setImportOpen] = useState(false);
  const [theme, setTheme] = useState<string>(localStorage.getItem("ikid-theme") ?? "system");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("ikid-theme", theme);
  }, [theme]);

  useEffect(() => {
    api.get<SettingsDTO>("/api/settings").then((s) => setCurrency(s.currency)).catch(() => {});
  }, []);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/transactions?search=${encodeURIComponent(search)}`);
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="no-print sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 px-2 pt-2">
          <IkidLogo height={34} />
          <div className="mt-1 text-[10px] uppercase tracking-widest text-slate-400">local finance</div>
        </div>
        <ProfileSwitcher auth={auth} />
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`
              }
            >
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-2 pb-2 text-[10px] text-slate-400">
          <a href="#/welcome" className="hover:text-brand-600">About Ikid →</a>
          <div className="mt-1">100% local · SQLite · no cloud</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <button className="btn-primary" onClick={() => setImportOpen(true)}>⬆ Import</button>
          <form onSubmit={submitSearch} className="max-w-md flex-1">
            <input
              className="input w-full"
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <button className="btn-ghost ml-auto" onClick={toggleTheme} title="Toggle dark mode">
            {document.documentElement.classList.contains("dark") ? "☀️" : "🌙"}
          </button>
        </header>

        <main className="flex-1 p-5">
          <Routes>
            <Route path="/" element={<Dashboard key={refreshKey} />} />
            <Route path="/transactions" element={<Transactions key={refreshKey} />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/analytics" element={<Analytics key={refreshKey} />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings onThemeChange={setTheme} />} />
          </Routes>
        </main>
      </div>

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [checked, setChecked] = useState(false);

  const checkAuth = () =>
    api
      .get<AuthStatus>("/api/auth/status")
      .then(setAuth)
      .catch(() => setAuth(null))
      .finally(() => setChecked(true));

  useEffect(() => {
    checkAuth();
    // Session expired mid-use → bounce to the login screen.
    const onUnauthorized = () => checkAuth();
    window.addEventListener("ikid:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ikid:unauthorized", onUnauthorized);
  }, []);

  if (!checked) return null;
  return (
    <HashRouter>
      <Routes>
        {/* Public — no sign-in required */}
        <Route path="/welcome" element={<Landing />} />
        <Route path="/signup" element={<SignupScreen />} />
        <Route
          path="*"
          element={
            auth?.enabled && !auth.signedIn ? (
              <LoginScreen status={auth} onSignedIn={() => location.reload()} />
            ) : (
              <Shell auth={auth} />
            )
          }
        />
      </Routes>
    </HashRouter>
  );
}

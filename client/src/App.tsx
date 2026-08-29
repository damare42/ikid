import { useEffect, useRef, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, IS_DEMO } from "./lib/api";
import { setCurrency } from "./lib/format";
import { pageEvent, track } from "./lib/track";
import type { SettingsDTO } from "@shared/types";
import { ImportDialog } from "./components/ImportDialog";
import { LoginScreen, type AuthStatus } from "./components/LoginScreen";
import { SignupScreen } from "./components/SignupScreen";
import { IkidLogo } from "./components/Logo";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Accounts from "./pages/Accounts";
import Budgets from "./pages/Budgets";
import Goals from "./pages/Goals";
import Planner from "./pages/Planner";
import NetWorth from "./pages/NetWorth";
import Calculators from "./pages/Calculators";
import Retirement from "./pages/Retirement";
import Admin from "./pages/Admin";
import Analytics from "./pages/Analytics";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Bills from "./pages/Bills";
import Reconcile from "./pages/Reconcile";
import DemoBanner from "./components/DemoBanner";

interface ProfilesInfo {
  active: string;
  profiles: { name: string; active: boolean; size: number }[];
}

// Rail is grouped: Money / Plan / Insight. Settings + Admin live in the
// avatar menu, not the rail (per the redesign).
const NAV_GROUPS = [
  {
    key: "gMoney",
    label: "Money",
    items: [
      { to: "/", label: "Dashboard", icon: "📊" },
      { to: "/transactions", label: "Transactions", icon: "🧾" },
      { to: "/accounts", label: "Accounts", icon: "🏦" },
      { to: "/reconcile", label: "Reconcile", icon: "⚖️" },
      { to: "/bills", label: "Bills", icon: "🗓️" },
      { to: "/budgets", label: "Budgets", icon: "🎯" },
      { to: "/goals", label: "Goals", icon: "🏁" },
    ],
  },
  {
    key: "gPlan",
    label: "Plan",
    items: [
      { to: "/networth", label: "Net Worth", icon: "💎" },
      { to: "/planner", label: "Planner", icon: "🧮" },
      { to: "/calculators", label: "Calculators", icon: "📐" },
      { to: "/retirement", label: "Retirement", icon: "🧭" },
    ],
  },
  {
    key: "gInsight",
    label: "Insight",
    items: [
      { to: "/analytics", label: "Analytics", icon: "📈" },
      { to: "/reports", label: "Reports", icon: "📄" },
    ],
  },
];

const ROUTE_LABELS: Record<string, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.to, i.label]))),
  "/settings": "Settings",
  "/admin": "Admin",
};

/** 34px avatar → dropdown: profile switcher (open mode), Settings, Admin, Sign out. */
function AvatarMenu({ auth }: { auth: AuthStatus | null }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ProfilesInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<ProfilesInfo>("/api/profiles").then(setInfo).catch(() => {});
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const who = (auth?.enabled ? auth.current : info?.active) ?? "?";
  const initial = who.charAt(0).toUpperCase();

  async function activate(name: string) {
    try {
      await api.post("/api/profiles/activate", { name });
      window.location.reload();
    } catch (e: any) { alert(e.message); }
  }
  async function newProfile() {
    const name = prompt("New profile name (e.g. partner, business):");
    if (!name?.trim()) return;
    try {
      const created = await api.post<{ name: string }>("/api/profiles", { name: name.trim() });
      await activate(created.name);
    } catch (e: any) { alert(e.message); }
  }
  async function signOut() {
    await api.post("/api/auth/logout").catch(() => {});
    // Land on the public welcome page rather than the login form: signing out
    // is usually "I'm done", not "let me log in as someone else".
    // `replace` rather than setting the hash, so Back doesn't walk into the
    // page they just left; `reload` is what actually clears the signed-in app
    // state from memory, since a hash-only change never reloads.
    const { pathname, search } = window.location;
    window.location.replace(`${pathname}${search}#/welcome`);
    window.location.reload();
  }
  function go(to: string) { setOpen(false); navigate(to); }

  const itemCls = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100 hover:text-brand-700 dark:hover:bg-slate-800";

  return (
    <div className="relative" ref={ref}>
      <button
        className="grid h-[34px] w-[34px] place-items-center rounded-chrome bg-brand-600 text-sm font-bold text-white"
        onClick={() => setOpen((o) => !o)}
        title={who}
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-[212px] border border-slate-200 bg-white py-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="truncate text-sm font-semibold">{who}</span>
            {auth?.isAdmin && (
              <span className="rounded-chrome bg-brand-100 px-1.5 py-0.5 text-[12px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">admin</span>
            )}
          </div>

          {!auth?.enabled && info && (
            <div className="border-t border-slate-100 py-1 dark:border-slate-800">
              <div className="px-3 py-1 text-[12px] font-semibold uppercase tracking-widest text-slate-400">Profiles</div>
              {info.profiles.map((p) => (
                <button key={p.name} className={itemCls} onClick={() => (p.name === info.active ? setOpen(false) : activate(p.name))}>
                  <span>👤</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.name === info.active && <span className="text-brand-600">✓</span>}
                </button>
              ))}
              <button className={itemCls} onClick={newProfile}><span>＋</span> New profile</button>
            </div>
          )}

          <div className="border-t border-slate-100 py-1 dark:border-slate-800">
            <button className={itemCls} onClick={() => go("/settings")}><span>⚙️</span> Settings</button>
            {auth?.isAdmin && <button className={itemCls} onClick={() => go("/admin")}><span>🛡️</span> Admin</button>}
            <a className={itemCls} href="#/welcome" onClick={() => setOpen(false)}><span>ℹ️</span> About Ikid</a>
            {auth?.enabled && (
              <button className={`${itemCls} hover:!text-brand-700`} onClick={signOut}><span>🚪</span> Sign out</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function applyTheme(theme: string) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function Shell({ auth }: { auth: AuthStatus | null }) {
  const [importOpen, setImportOpen] = useState(false);
  const [importAccount, setImportAccount] = useState<number | null>(null);
  const [theme, setTheme] = useState<string>(localStorage.getItem("ikid-theme") ?? "system");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("ikid-nav-groups") ?? "") ?? {}; }
    catch { return {}; }
  });
  const isGroupOpen = (k: string) => openGroups[k] !== false; // default open
  function toggleGroup(k: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [k]: prev[k] === false ? true : false };
      localStorage.setItem("ikid-nav-groups", JSON.stringify(next));
      return next;
    });
  }

  // Collapsing the whole rail to icons buys back ~160px, which matters on the
  // wide tables (Transactions, Reconcile) and on a 13" laptop generally.
  // Remembered, because a person who wants the room wants it every time.
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem("ikid-nav-collapsed") === "1",
  );
  function toggleRail() {
    setRailCollapsed((prev) => {
      localStorage.setItem("ikid-nav-collapsed", prev ? "0" : "1");
      return !prev;
    });
  }
  const sectionLabel = ROUTE_LABELS[location.pathname] ?? "";

  // Page-view telemetry (feature key only, no data).
  useEffect(() => {
    track(pageEvent(location.pathname));
  }, [location.pathname]);

  // Let any page open the import dialog (optionally preselecting an account).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { accountId?: number | null } | undefined;
      setImportAccount(detail?.accountId ?? null);
      setImportOpen(true);
    };
    window.addEventListener("ikid:open-import", onOpen);
    return () => window.removeEventListener("ikid:open-import", onOpen);
  }, []);

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
      {/* Rail */}
      <aside
        className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white py-6 transition-[width] duration-200 md:flex dark:border-slate-800 dark:bg-slate-900 ${
          railCollapsed ? "w-[56px] px-2" : "w-[184px] px-4"
        }`}
      >
        {/* The toggle lives with the brand, not at the foot of the rail: it's
            chrome for the panel itself, so it belongs at the panel's head where
            you look first. Icon only — a button labelled "Collapse" is one more
            word competing with the navigation it's meant to get out of the way
            of. */}
        <div className={`mb-6 flex ${railCollapsed ? "flex-col items-center gap-2" : "items-start gap-2"}`}>
          <div className="min-w-0 flex-1">
            {/* The wordmark is ~1.54:1, so 22px high is ~34px wide and still
                fits the 44px of content the collapsed rail leaves. */}
            <IkidLogo height={railCollapsed ? 22 : 30} />
            {!railCollapsed && (
              <div className="mt-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">local finance</div>
            )}
          </div>
          <button
            onClick={toggleRail}
            className="shrink-0 rounded-chrome p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!railCollapsed}
          >
            {/* Drawn rather than typed: "«" renders at the mercy of the font and
                came out small and off-centre. An SVG is the same size on every
                platform and can be given a real 20px target. */}
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <line x1="9.5" y1="4" x2="9.5" y2="20" />
              {railCollapsed
                ? <polyline points="14,9.5 16.5,12 14,14.5" />
                : <polyline points="16.5,9.5 14,12 16.5,14.5" />}
            </svg>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((g) => (
            <div key={g.key}>
              {/* Collapsed, the group headings are just noise — the icons are
                  the whole navigation — but a hairline keeps the grouping
                  legible rather than running everything together. */}
              {railCollapsed ? (
                <div className="mx-2 mb-1 border-t border-slate-100 first:border-0 dark:border-slate-800" />
              ) : (
                <button
                  className="flex w-full items-center justify-between px-1 pb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={() => toggleGroup(g.key)}
                >
                  {g.label}
                  <span className={`text-[11px] transition-transform ${isGroupOpen(g.key) ? "" : "-rotate-90"}`}>▾</span>
                </button>
              )}
              {(railCollapsed || isGroupOpen(g.key)) && (
                <div className="flex flex-col">
                  {g.items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === "/"}
                      // Collapsed to icons, the label has to survive somewhere
                      // or the nav becomes a guessing game: title for pointer
                      // users, aria-label for screen readers.
                      title={railCollapsed ? n.label : undefined}
                      aria-label={railCollapsed ? n.label : undefined}
                      // Active state is NOT signalled by colour alone (WCAG 1.4.1):
                      // accent text + a 2px left rule + heavier weight.
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 border-l-2 py-[7px] text-[13px] transition-colors ${
                          railCollapsed ? "justify-center pl-0" : "pl-2"
                        } ${
                          isActive
                            ? "border-brand-600 font-extrabold text-brand-700 dark:text-brand-400"
                            : "border-transparent font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                        }`
                      }
                    >
                      <span className="w-4 text-center">{n.icon}</span>
                      {!railCollapsed && n.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        {!railCollapsed && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-[12px] text-slate-400 dark:border-slate-800">
            100% local · SQLite · no cloud
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">{sectionLabel}</div>
          <form onSubmit={submitSearch} className="mx-auto hidden max-w-sm flex-1 sm:block">
            <input
              className="input w-full"
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-primary" onClick={() => setImportOpen(true)}>↑ Import</button>
            <button className="btn-ghost !px-2" onClick={toggleTheme} title="Toggle dark mode">
              {document.documentElement.classList.contains("dark") ? "☀️" : "🌙"}
            </button>
            <AvatarMenu auth={auth} />
          </div>
        </header>

        {/* Sits above the routed page, so it's present on every screen — the
            one thing you must never miss is that these numbers aren't yours. */}
        <DemoBanner />

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<Dashboard key={refreshKey} />} />
            <Route path="/transactions" element={<Transactions key={refreshKey} />} />
            <Route path="/accounts" element={<Accounts key={refreshKey} />} />
            <Route path="/reconcile" element={<Reconcile key={refreshKey} />} />
            <Route path="/bills" element={<Bills key={refreshKey} />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/networth" element={<NetWorth />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/calculators" element={<Calculators />} />
            <Route path="/retirement" element={<Retirement />} />
            {auth?.isAdmin && <Route path="/admin" element={<Admin />} />}
            <Route path="/analytics" element={<Analytics key={refreshKey} />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings onThemeChange={setTheme} />} />
          </Routes>
        </main>
      </div>

      {importOpen && (
        <ImportDialog
          initialAccountId={importAccount}
          onClose={() => { setImportOpen(false); setImportAccount(null); }}
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
        {/* There is nothing to sign up to in the demo: no server, no accounts.
            Showing the form and failing on submit would waste someone's time
            and teach them the wrong thing about the product. */}
        <Route path="/signup" element={IS_DEMO ? <Landing /> : <SignupScreen />} />
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

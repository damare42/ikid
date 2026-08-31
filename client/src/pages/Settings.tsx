import { useState, type ChangeEvent } from "react";
import type { CategoryDTO, RuleDTO, SettingsDTO, ImportDTO, AccountDTO, MerchantDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { setCurrency } from "../lib/format";
import { Badge, Card, ErrorNote, Spinner } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { DemoModeCard } from "../components/DemoBanner";

export default function Settings({ onThemeChange }: { onThemeChange: (t: string) => void }) {
  const { data: settings, setData: setSettings } = useFetch<SettingsDTO>("/api/settings");
  const { data: categories, refresh: refreshCats } = useFetch<CategoryDTO[]>("/api/categories");
  const { data: rules, refresh: refreshRules } = useFetch<RuleDTO[]>("/api/rules");
  const { data: imports, refresh: refreshImports } = useFetch<ImportDTO[]>("/api/imports");
  const { data: accounts, refresh: refreshAccounts } = useFetch<AccountDTO[]>("/api/accounts");
  const { data: merchants, refresh: refreshMerchants } = useFetch<MerchantWithCount[]>("/api/merchants");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patchSettings(patch: Partial<SettingsDTO>) {
    const updated = await api.patch<SettingsDTO>("/api/settings", patch);
    setSettings({ ...settings!, ...patch } as SettingsDTO);
    if (patch.currency) setCurrency(patch.currency);
    if (patch.theme) onThemeChange(patch.theme);
    void updated;
  }

  async function backup() {
    try {
      const r = await api.post<{ file: string }>("/api/settings/backup");
      setMsg(`Backup created: ${r.file} (in database/backups/)`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function recategorize(all: boolean) {
    setMsg(null);
    const r = await api.post<{ scanned: number; updated: number }>("/api/transactions/recategorize", { onlyUnknown: !all });
    setMsg(`Re-applied rules: ${r.updated} of ${r.scanned} transactions updated.`);
  }

  async function detectTransfers() {
    setMsg(null);
    const r = await api.post<{ scanned: number; flagged: number }>("/api/transactions/detect-transfers");
    setMsg(`Transfer scan: flagged ${r.flagged} of ${r.scanned} transactions as transfers (excluded from income/spending).`);
  }

  if (!settings) return <Spinner />;

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="font-heading text-2xl font-extrabold tracking-tight">Settings</h1>
      {msg && <div className="rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-200">{msg}</div>}
      {error && <ErrorNote message={error} />}

      <Card title="Preferences">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="label">Currency</label>
            <select className="input w-full" value={settings.currency} onChange={(e) => patchSettings({ currency: e.target.value })}>
              {["USD", "EUR", "GBP", "CAD", "ETB"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date format</label>
            <select className="input w-full" value={settings.dateFormat} onChange={(e) => patchSettings({ dateFormat: e.target.value })}>
              <option>MM/DD/YYYY</option>
              <option>DD/MM/YYYY</option>
              <option>YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label className="label">Theme</label>
            <select className="input w-full" value={settings.theme} onChange={(e) => patchSettings({ theme: e.target.value as SettingsDTO["theme"] })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </Card>

      <Card title="Accounts">
        <AccountsEditor accounts={accounts ?? []} onChanged={refreshAccounts} />
      </Card>

      <Card title="Categories">
        <CategoriesEditor categories={categories ?? []} onChanged={refreshCats} />
      </Card>

      <Card
        title="Merchants"
        action={
          <button
            className="btn-ghost !py-1 text-xs"
            title='Merge variants automatically, e.g. "Ipic Atlanta" + "Ipic Atlanta Boca Raton" → "IPIC", "Zara Usa" → "Zara", "WM Supercenter" → "Walmart"'
            onClick={async () => {
              const r = await api.post<{ groups: number; merchantsTouched: number }>("/api/merchants/normalize");
              setMsg(
                r.groups > 0
                  ? `Auto-merge: combined ${r.merchantsTouched} merchant variants into ${r.groups} merchants.`
                  : "Auto-merge: nothing to combine — merchants already look clean.",
              );
              refreshMerchants();
            }}
          >
            ✨ Auto-merge similar
          </button>
        }
      >
        <MerchantsEditor merchants={merchants ?? []} onChanged={refreshMerchants} />
      </Card>

      <Card
        title={`Categorization Rules (${rules?.length ?? 0})`}
        action={
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost !py-1 text-xs" onClick={() => recategorize(false)}>Apply to Unknown</button>
            <button className="btn-ghost !py-1 text-xs" onClick={() => recategorize(true)}>Re-apply to all</button>
            <button className="btn-ghost !py-1 text-xs" onClick={detectTransfers} title="Flag card payments and savings moves so they don't count as income or spending">Detect transfers</button>
          </div>
        }
      >
        <RulesEditor rules={rules ?? []} categories={categories ?? []} onChanged={refreshRules} />
      </Card>

      <Card
        title="Import History"
        action={
          imports?.length && accounts?.length ? (
            <button
              className="btn-ghost !py-1 text-xs"
              title="Match each import's filename to an account (e.g. 'chase-oct.csv' → Chase) and assign its transactions"
              onClick={async () => {
                const matches = (imports ?? [])
                  .map((im) => ({ im, acc: matchAccountByFilename(im.filename, accounts ?? []) }))
                  .filter((m) => m.acc && m.im.accountId !== m.acc.id);
                if (matches.length === 0) { setMsg("No new filename→account matches found."); return; }
                if (!confirm(`Assign ${matches.length} import(s) to accounts matched from their filenames?`)) return;
                let total = 0;
                for (const m of matches) {
                  const r = await api.post<{ updated: number }>(`/api/imports/${m.im.id}/assign-account`, { accountId: m.acc!.id });
                  total += r.updated;
                }
                refreshImports(); refreshAccounts();
                setMsg(`Assigned ${total} transaction(s) across ${matches.length} import(s) by filename.`);
              }}
            >
              ✨ Auto-assign by filename
            </button>
          ) : undefined
        }
      >
        {!imports?.length ? (
          <div className="text-sm text-slate-500">No imports yet.</div>
        ) : (
          <div className="overflow-x-auto">
            {/* Scrolls sideways rather than squashing. On a phone these columns are
                wider than the screen, and a table that drags the whole page into
                horizontal scrolling is the worse of the two failures. */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="th">File</th><th className="th">Account</th><th className="th">When</th>
                  <th className="th text-right">Rows</th><th className="th text-right">Dupes</th><th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {imports.map((im) => (
                  <ImportRow
                    key={im.id}
                    im={im}
                    accounts={accounts ?? []}
                    onChanged={() => { refreshImports(); refreshAccounts(); }}
                    onMessage={setMsg}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Profile">
        <ProfileEditor onMessage={setMsg} />
      </Card>

      <Card title="Security & Accounts">
        <SecurityEditor onMessage={setMsg} />
      </Card>

      <DemoModeCard onMessage={setMsg} />

      <Card title="Your data — take it anywhere">
        <PortableData onMessage={setMsg} onError={setError} />
      </Card>

      <Card title="Database">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={backup}>Backup database</button>
          <a className="btn-ghost" href="/api/settings/export" download>Export .db file</a>
          <label className="btn-ghost cursor-pointer">
            Restore from .db file
            <input
              type="file"
              accept=".db"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !confirm("Restore will overwrite your current database. Continue?")) return;
                const form = new FormData();
                form.append("file", f);
                const r = await api.upload<{ note: string }>("/api/settings/restore-upload", form);
                setMsg(r.note);
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Everything lives in <code>database/ikid.db</code> on this machine. Backups are written to <code>database/backups/</code>.
        </p>
      </Card>
    </div>
  );
}

type ImportSummary = Record<string, number>;

/**
 * Lossless JSON export/import. The .db file is the fast path for "same app,
 * same machine"; this is the escape hatch — plain readable JSON that references
 * categories, merchants and accounts by name, so it survives being opened in a
 * text editor, diffed, or imported into a different profile.
 */
function PortableData({ onMessage, onError }: {
  onMessage: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function importJson(file: File, mode: "merge" | "replace") {
    setBusy(true);
    setSummary(null);
    onError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ mode: string; summary: ImportSummary }>(
        `/api/settings/import.json?mode=${mode}`,
        form,
      );
      setSummary(r.summary);
      onMessage(
        `Imported ${r.summary.transactions} transaction(s)` +
          (r.summary.duplicateTransactions
            ? `, skipped ${r.summary.duplicateTransactions} already here`
            : "") +
          ". Reload to see everything.",
      );
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function pick(mode: "merge" | "replace") {
    return async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ""; // let the same file be chosen twice
      if (!f) return;
      if (
        mode === "replace" &&
        !confirm(
          "Replace will DELETE everything in this profile and load the file instead.\n\n" +
            "Make a backup first if you're not sure. Continue?",
        )
      ) return;
      await importJson(f, mode);
    };
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary" href="/api/settings/export.json" download>
          Export everything as JSON
        </a>
        <label className={`btn-ghost cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Importing…" : "Import JSON (merge)"}
          <input type="file" accept=".json,application/json" className="hidden" onChange={pick("merge")} />
        </label>
        <label className={`btn-ghost cursor-pointer text-rose-500 ${busy ? "pointer-events-none opacity-50" : ""}`}>
          Import JSON (replace all)
          <input type="file" accept=".json,application/json" className="hidden" onChange={pick("replace")} />
        </label>
      </div>

      {summary && (
        <table className="text-sm">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(summary)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <tr key={k}>
                  <td className="td capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</td>
                  <td className="td text-right tabular-nums">{n}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-slate-500">
        Plain, readable JSON — every transaction, account, category, rule, budget, goal, asset,
        import record, saved calculation and planner conversation. Relations are stored{" "}
        <b>by name</b>, not by database ID, so the file opens in any text editor and imports cleanly
        into another profile.
        <b> Merge</b> adds what's missing and skips transactions you already have;
        <b> replace</b> wipes this profile first. Your data is yours — this is the way out.
      </p>
    </div>
  );
}

const compactName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match an import's filename to an account by name (e.g. "chase-oct.csv" → Chase). */
export function matchAccountByFilename(filename: string, accounts: AccountDTO[]): AccountDTO | null {
  const f = compactName(filename);
  // Longest account name first, so "Capital One" beats a stray "One".
  const byLength = [...accounts].sort((a, b) => compactName(b.name).length - compactName(a.name).length);
  return byLength.find((a) => compactName(a.name).length >= 3 && f.includes(compactName(a.name))) ?? null;
}

function ImportRow({ im, accounts, onChanged, onMessage }: {
  im: ImportDTO; accounts: AccountDTO[]; onChanged: () => void; onMessage: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(im.filename);
  const [busy, setBusy] = useState(false);

  const matched = matchAccountByFilename(im.filename, accounts);
  // Show the assigned account if set, else the filename suggestion.
  const [accountId, setAccountId] = useState<number | "">(im.accountId ?? matched?.id ?? "");
  const suggested = im.accountId == null && matched != null && accountId === matched.id;

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === im.filename) { setEditing(false); setName(im.filename); return; }
    setBusy(true);
    try {
      await api.patch(`/api/imports/${im.id}`, { filename: trimmed });
      setEditing(false);
      onChanged();
    } catch {
      setName(im.filename);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    setBusy(true);
    try {
      const r = await api.post<{ updated: number }>(`/api/imports/${im.id}/assign-account`, {
        accountId: accountId === "" ? null : accountId,
      });
      onChanged();
      const target = accounts.find((a) => a.id === accountId)?.name ?? "no account";
      onMessage(`Assigned ${r.updated} transaction(s) from "${im.filename}" to ${target}.`);
    } finally {
      setBusy(false);
    }
  }

  const dirty = (accountId === "" ? null : accountId) !== (im.accountId ?? null);

  return (
    <tr className={suggested ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}>
      <td className="td">
        {editing ? (
          <input
            className="input !py-0.5 w-52"
            autoFocus
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setEditing(false); setName(im.filename); } }}
            onBlur={saveName}
          />
        ) : (
          <button className="text-left hover:text-brand-600" title="Click to rename" onClick={() => setEditing(true)}>
            {im.filename} <span className="ml-1 text-xs text-slate-400">✎</span>
          </button>
        )}
      </td>
      <td className="td">
        <div className="flex items-center gap-1">
          <select
            className="input !py-0.5 max-w-[9rem]"
            value={accountId}
            disabled={busy || accounts.length === 0}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— none —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {dirty && (
            <button className="btn-primary !px-2 !py-0.5 text-xs" disabled={busy} onClick={assign}>
              {suggested ? "Assign ✓" : "Assign"}
            </button>
          )}
        </div>
        {suggested && <div className="mt-0.5 text-[12px] text-amber-600">matched from filename</div>}
      </td>
      <td className="td text-slate-500 whitespace-nowrap">{new Date(im.importedAt).toLocaleString()}</td>
      <td className="td text-right">{im.transactionCount}</td>
      <td className="td text-right">{im.duplicateCount}</td>
      <td className="td text-right">
        <button
          className="btn-ghost !px-2 !py-0.5 text-xs text-rose-500"
          onClick={async () => {
            if (!confirm(`Undo import "${im.filename}"? Its ${im.transactionCount} transactions will be deleted.`)) return;
            await api.delete(`/api/imports/${im.id}`);
            onChanged();
          }}
        >
          Undo
        </button>
      </td>
    </tr>
  );
}

function ProfileEditor({ onMessage }: { onMessage: (m: string) => void }) {
  const { data } = useFetch<{
    active: string;
    profiles: { name: string; id: string; active: boolean }[];
  }>("/api/profiles");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <Spinner />;
  const me = data.profiles.find((p) => p.name === data.active);

  async function rename() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ from: string; to: string }>("/api/profiles/rename", {
        name: newName.trim(),
      });
      onMessage(`Profile renamed: ${r.from} → ${r.to}. Your data, password, and sign-in all moved with it.`);
      setNewName("");
      setTimeout(() => location.reload(), 800);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>
          Profile name: <b>{data.active}</b>
        </span>
        <span className="text-slate-500">
          Account ID:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{me?.id ?? "—"}</code>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="input flex-1 max-w-xs"
          placeholder="New profile name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn-primary" onClick={rename} disabled={busy || !newName.trim()}>
          {busy ? "Renaming…" : "Rename"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Renaming moves your database, password, and active sign-ins to the new name. The account ID
        is permanent — it uniquely identifies this profile no matter how often it's renamed.
      </p>
    </div>
  );
}

function SecurityEditor({ onMessage }: { onMessage: (m: string) => void }) {
  const { data: auth, refresh } = useFetch<{
    enabled: boolean;
    current: string | null;
    profiles: { name: string; protected: boolean }[];
  }>("/api/auth/status");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!auth) return <Spinner />;
  const me = auth.profiles.find((p) => p.name === auth.current);
  const isProtected = me?.protected ?? false;

  async function setPw() {
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    try {
      await api.post("/api/auth/set-password", {
        password,
        currentPassword: isProtected ? current : undefined,
      });
      onMessage(
        isProtected
          ? "Password changed."
          : "Password set — sign-in is now required. Each profile is a separate account with its own data.",
      );
      setCurrent(""); setPassword(""); setConfirm("");
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removePw() {
    setError(null);
    if (!current) {
      setError("Enter your current password to remove it");
      return;
    }
    try {
      await api.post("/api/auth/remove-password", { currentPassword: current });
      onMessage("Password removed for this profile.");
      setCurrent("");
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {auth.enabled
          ? <>Accounts are <b>on</b> — signing in is required. Signed in as <b>{auth.current}</b>{isProtected ? " (password protected)" : " (no password yet — set one below)"}.</>
          : <>Accounts are <b>off</b>. Set a password on this profile to require sign-in; other people can then use their own profiles as separate accounts.</>}
      </p>
      {error && <ErrorNote message={error} />}
      <div className="grid gap-2 md:grid-cols-3">
        {isProtected && (
          <div>
            <label className="label">Current password</label>
            <PasswordInput value={current} onChange={setCurrent} />
          </div>
        )}
        <div>
          <label className="label">{isProtected ? "New password" : "Password"}</label>
          <PasswordInput value={password} onChange={setPassword} />
        </div>
        <div>
          <label className="label">Confirm</label>
          <PasswordInput value={confirm} onChange={setConfirm} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={setPw} disabled={password.length < 4}>
          {isProtected ? "Change password" : "Set password & require sign-in"}
        </button>
        {isProtected && (
          <button className="btn-ghost text-rose-500" onClick={removePw}>
            Remove password
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Passwords are scrypt-hashed with per-profile salts; sessions are HttpOnly cookies (24h).
        Data stays local — this protects against other people using this computer, not a lost laptop
        (use disk encryption like FileVault for that).
      </p>
    </div>
  );
}

type MerchantWithCount = MerchantDTO & { _count: { transactions: number } };

function MerchantsEditor({ merchants, onChanged }: {
  merchants: MerchantWithCount[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetName, setTargetName] = useState("");
  const [merging, setMerging] = useState(false);

  const shown = merchants
    .filter((m) => m._count.transactions > 0)
    .filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b._count.transactions - a._count.transactions)
    .slice(0, 100);

  function toggle(id: number, _name: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    // Always recompute the suggested target from the CURRENT selection, so a
    // deselected merchant's name can never linger as the merge target.
    const names = merchants.filter((m) => next.has(m.id)).map((m) => m.name);
    setTargetName(names.sort((a, b) => a.length - b.length)[0] ?? "");
  }

  async function merge() {
    if (selected.size < 2 || !targetName.trim()) return;
    setMerging(true);
    try {
      await api.post("/api/merchants/merge", { ids: [...selected], name: targetName.trim() });
      setSelected(new Set());
      setTargetName("");
      onChanged();
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Filter merchants… (select 2+ to merge them)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {selected.size >= 2 && (
          <>
            <input
              className="input w-44"
              placeholder="Merged name"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
            />
            <button className="btn-primary" onClick={merge} disabled={merging || !targetName.trim()}>
              Merge {selected.size}
            </button>
          </>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="overflow-x-auto">
          {/* Scrolls sideways rather than squashing. On a phone these columns are
              wider than the screen, and a table that drags the whole page into
              horizontal scrolling is the worse of the two failures. */}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((m) => (
                <tr
                  key={m.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => toggle(m.id, m.name)}
                >
                  <td className="td w-8">
                    <input type="checkbox" readOnly checked={selected.has(m.id)} />
                  </td>
                  <td className="td">{m.name}</td>
                  <td className="td text-right text-xs text-slate-400">{m._count.transactions} txns</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Tick the variants of the same merchant, give them one name, and merge. "Auto-merge similar"
        handles the obvious ones (location suffixes, Zara/Zara Usa, WM Supercenter/Walmart…).
      </p>
    </div>
  );
}

function AccountsEditor({ accounts, onChanged }: { accounts: AccountDTO[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  return (
    <div className="space-y-2">
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between text-sm">
          <span>{a.name} <span className="text-xs text-slate-400">({a.type})</span></span>
          <span className="tabular-nums text-slate-500">{a.balance != null && a.balance.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <input className="input flex-1" placeholder="New account name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {["checking", "savings", "credit", "loan"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <button
          className="btn-primary"
          disabled={!name.trim()}
          onClick={async () => { await api.post("/api/accounts", { name: name.trim(), type }); setName(""); onChanged(); }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function CategoriesEditor({ categories, onChanged }: { categories: CategoryDTO[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  // A new category is a category, not income — it shouldn't be handed the
  // money-in green as its default swatch.
  const [color, setColor] = useState("#3a6098");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => <Badge key={c.id} color={c.color}>{c.name}</Badge>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="input !p-1" value={color} onChange={(e) => setColor(e.target.value)} />
        <button
          className="btn-primary"
          disabled={!name.trim()}
          onClick={async () => { await api.post("/api/categories", { name: name.trim(), color, type: "expense" }); setName(""); onChanged(); }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RulesEditor({ rules, categories, onChanged }: {
  rules: RuleDTO[]; categories: CategoryDTO[]; onChanged: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const shown = rules.filter(
    (r) => !filter || r.keyword.toLowerCase().includes(filter.toLowerCase()) || r.categoryName?.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" placeholder='Match phrase, e.g. "STARBUCKS"' value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          className="btn-primary"
          disabled={!keyword.trim() || !categoryId}
          onClick={async () => {
            await api.post("/api/rules", { keyword: keyword.trim(), categoryId: Number(categoryId) });
            setKeyword("");
            onChanged();
          }}
        >
          Add
        </button>
      </div>
      <input className="input w-full" placeholder="Filter rules…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="overflow-x-auto">
          {/* Scrolls sideways rather than squashing. On a phone these columns are
              wider than the screen, and a table that drags the whole page into
              horizontal scrolling is the worse of the two failures. */}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="td font-mono text-xs">{r.keyword}</td>
                  <td className="td">→ {r.categoryName}</td>
                  <td className="td text-xs text-slate-400">{r.source}</td>
                  <td className="td text-right">
                    <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={async () => { await api.delete(`/api/rules/${r.id}`); onChanged(); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

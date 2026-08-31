import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { AdminOverviewDTO, AdminUserDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { Card, ErrorNote, Spinner, StatCard } from "../components/ui";
import { useChartColors } from "../lib/chartColors";

/**
 * 🛡️ Admin — account management + usage analytics. Admin-only (the server
 * also enforces this). Shows how many people use the app and which features
 * they use — never any financial data.
 */
export default function Admin() {
  const c = useChartColors();
  const { data: overview, loading, error, refresh } = useFetch<AdminOverviewDTO>("/api/admin/overview");
  const { data: users, refresh: refreshUsers } = useFetch<AdminUserDTO[]>("/api/admin/users");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function act(fn: () => Promise<any>, key: string) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      refresh();
      refreshUsers();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !overview) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!overview) return null;

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Admin</h1>
          <p className="text-xs text-slate-500">Accounts &amp; usage — no financial data is ever shown here.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overview.config.allowSignups}
            onChange={(e) => act(() => api.post("/api/admin/config", { allowSignups: e.target.checked }), "cfg")}
          />
          Allow new sign-ups
        </label>
      </div>

      {note && <ErrorNote message={note} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total users" value={String(overview.totalUsers)} sub={`${overview.admins} admin${overview.admins === 1 ? "" : "s"}`} />
        <StatCard label="New (7d)" value={`+${overview.newUsers7d}`} tone={overview.newUsers7d > 0 ? "good" : "default"} />
        <StatCard label="Active (7d)" value={String(overview.activeUsers7d)} sub="signed-in & active" />
        <StatCard label="Active (30d)" value={String(overview.activeUsers30d)} />
        <StatCard label="Disabled" value={String(overview.disabled)} tone={overview.disabled > 0 ? "bad" : "default"} />
        <StatCard label="Events (7d)" value={String(overview.events7d)} sub={`${overview.totalEvents} all-time`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Most-used features">
          {overview.byFeature.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">No activity recorded yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={overview.byFeature} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} horizontal={false} />
                <XAxis type="number" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="feature" fontSize={11} width={110} />
                <Tooltip formatter={(v: number) => [`${v} events`, ""]} />
                <Bar dataKey="count" fill={c.series[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Activity — last 30 days">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={overview.byDay}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="day" fontSize={10} tickFormatter={(d) => d.slice(5)} interval={4} />
              <YAxis fontSize={11} allowDecimals={false} width={30} />
              <Tooltip />
              <Line type="monotone" dataKey="events" name="Events" stroke={c.series[0]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="users" name="Active users" stroke={c.series[1]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Accounts">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="th">User</th>
                <th className="th">ID</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Created</th>
                <th className="th">Last login</th>
                <th className="th text-right">Events</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(users ?? []).map((u) => (
                <tr key={u.name} className={u.disabled ? "opacity-50" : ""}>
                  <td className="td font-medium">
                    👤 {u.name}{u.isSelf && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="td font-mono text-xs text-slate-400">{u.id}</td>
                  <td className="td">
                    {u.role === "admin"
                      ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">admin</span>
                      : <span className="text-slate-500">user</span>}
                  </td>
                  <td className="td">
                    {u.disabled
                      ? <span className="text-rose-500 dark:text-rose-400">disabled</span>
                      : <span className="text-emerald-600 dark:text-emerald-400">active</span>}
                  </td>
                  <td className="td text-xs text-slate-500">{fmtDate(u.createdAt)}</td>
                  <td className="td text-xs text-slate-500">{fmtDate(u.lastLogin)}</td>
                  <td className="td text-right tabular-nums">{u.eventCount}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button
                      className="btn-ghost !px-2 !py-0.5 text-xs"
                      disabled={busy === u.name}
                      onClick={() => act(() => api.post(`/api/admin/users/${u.name}/role`, { role: u.role === "admin" ? "user" : "admin" }), u.name)}
                    >
                      {u.role === "admin" ? "Demote" : "Make admin"}
                    </button>
                    <button
                      className="btn-ghost !px-2 !py-0.5 text-xs"
                      disabled={busy === u.name}
                      onClick={() => act(() => api.post(`/api/admin/users/${u.name}/disabled`, { disabled: !u.disabled }), u.name)}
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      className="btn-ghost !px-2 !py-0.5 text-xs"
                      disabled={busy === u.name}
                      onClick={() => {
                        const pw = prompt(`New password for "${u.name}" (min 4 chars):`);
                        if (pw && pw.length >= 4) act(() => api.post(`/api/admin/users/${u.name}/reset-password`, { password: pw }), u.name);
                      }}
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Disabling or resetting a password signs that user out immediately. You can't demote or disable the last admin.
          Profiles stay fully isolated — no admin can open another user's financial data.
        </p>
      </Card>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { fmtMoney, fmtMonth } from "../lib/format";
import { Card } from "../components/ui";
import { useChartColors } from "../lib/chartColors";

interface ChartPoint {
  month: string;
  baseline: number;
  scenario: number;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  title?: string | null;
  chart?: ChartPoint[] | null;
  source?: string;
}

interface PlannerStatus {
  profile: {
    avgMonthlyIncome: number;
    avgMonthlyExpenses: number;
    avgMonthlySavings: number;
    savingsRate: number;
    liquidSavings: number;
    monthsOfData: number;
  };
  ollama: { available: boolean; model: string; reason?: string };
}

const QUICK = [
  { label: "🏠 Buy a house", text: "Buy a house for $450k with 20% down" },
  { label: "🚗 Buy a car", text: "Buy a $30k car" },
  { label: "💍 Wedding", text: "Wedding costing $25k in 18 months" },
  { label: "📦 Moving", text: "Moving, about $6k in 3 months" },
  { label: "📊 Invest monthly", text: "Invest $500 a month at 7% for 20 years" },
  { label: "🛑 Stop working", text: "What if I stop working for 6 months?" },
  { label: "📈 Expenses up", text: "What if my expenses go up $500 a month?" },
];

interface ConvoSummary {
  id: number;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export default function Planner() {
  const c = useChartColors();
  const [status, setStatus] = useState<PlannerStatus | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convos, setConvos] = useState<ConvoSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<PlannerStatus>("/api/planner/status").then(setStatus).catch(() => {});
    refreshConvos();
  }, []);

  function refreshConvos() {
    api.get<ConvoSummary[]>("/api/planner/conversations").then(setConvos).catch(() => {});
  }

  async function saveConversation() {
    if (messages.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (currentId != null) {
        await api.patch(`/api/planner/conversations/${currentId}`, { messages });
      } else {
        const firstUser = messages.find((m) => m.role === "user")?.content ?? "Conversation";
        const title = firstUser.slice(0, 60);
        const r = await api.post<{ id: number }>("/api/planner/conversations", { title, messages });
        setCurrentId(r.id);
      }
      refreshConvos();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e: any) {
      setSaveState("error");
      setSaveError(e.message ?? "Could not save the conversation");
    } finally {
      setSaving(false);
    }
  }

  async function loadConversation(id: number) {
    const r = await api.get<{ id: number; title: string; messages: Msg[] }>(
      `/api/planner/conversations/${id}`,
    );
    setMessages(r.messages);
    setCurrentId(r.id);
  }

  async function deleteConversation(id: number) {
    if (!confirm("Delete this saved conversation?")) return;
    await api.delete(`/api/planner/conversations/${id}`);
    if (currentId === id) setCurrentId(null);
    refreshConvos();
  }

  function newConversation() {
    setMessages([]);
    setCurrentId(null);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const r = await api.post<{
        source: string; title: string | null; reply: string; chart: ChartPoint[] | null;
      }>("/api/planner/chat", { message, history });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: r.reply, title: r.title, chart: r.chart, source: r.source },
      ]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Something went wrong: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  // The three figures the empty state quotes, only if they're all real numbers.
  const p = status?.profile;
  const profileNumbers =
    p &&
    [p.avgMonthlyIncome, p.avgMonthlyExpenses, p.avgMonthlySavings].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
      ? p
      : null;

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Planner</h1>
          <select
            className="input !py-1 text-xs"
            value={currentId ?? ""}
            onChange={(e) => {
              if (e.target.value) loadConversation(Number(e.target.value));
            }}
            title="Open a saved conversation"
          >
            <option value="">{convos.length ? "Saved conversations…" : "No saved conversations"}</option>
            {convos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.messageCount})
              </option>
            ))}
          </select>
          <button
            className="btn-ghost !py-1 text-xs"
            onClick={saveConversation}
            disabled={messages.length === 0 || saving}
            title={currentId != null ? "Update this saved conversation" : "Save this conversation"}
          >
            {saving
              ? "Saving…"
              : saveState === "saved"
                ? "✓ Saved"
                : currentId != null
                  ? "💾 Update"
                  : "💾 Save"}
          </button>
          {currentId != null && (
            <button
              className="btn-ghost !py-1 text-xs text-rose-500"
              onClick={() => deleteConversation(currentId)}
              title="Delete this saved conversation"
            >
              ✕
            </button>
          )}
          <button className="btn-ghost !py-1 text-xs" onClick={newConversation} disabled={messages.length === 0}>
            ＋ New
          </button>
        </div>
        {status && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              status.ollama.available
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
            title={
              status.ollama.available
                ? "Freeform questions answered by a local LLM — nothing leaves your machine"
                : status.ollama.reason ??
                  "Exact scenario engine active. Install Ollama (ollama.com) for freeform chat."
            }
          >
            {status.ollama.available ? `🤖 Local AI: ${status.ollama.model}` : "🧮 Engine mode (no AI installed)"}
          </span>
        )}
      </div>

      {saveError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          Save failed: {saveError}
        </div>
      )}

      {/* Messages */}
      <Card className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-4xl">🧮</div>
            <div className="font-medium">Model a decision before you make it</div>
            <p className="max-w-md text-sm text-slate-500">
              I use your real numbers
              {/* Guarded, because this line took the whole page down once. If
                  /api/planner/status came back without a numeric profile,
                  fmtMoney received undefined, `undefined.toLocaleString` threw
                  during render, and React unmounted the route — a blank
                  Planner, with the actual fault three layers away in an
                  endpoint. One bad field should cost one sentence. */}
              {profileNumbers &&
                ` — ${fmtMoney(profileNumbers.avgMonthlyIncome)}/mo income, ${fmtMoney(profileNumbers.avgMonthlyExpenses)}/mo expenses, ${fmtMoney(profileNumbers.avgMonthlySavings)}/mo saved`}
              . Ask about a house, car, wedding, moving, a career break, or income/expense changes.
            </p>
            <div className="flex max-w-lg flex-wrap justify-center gap-2">
              {QUICK.map((q) => (
                <button key={q.label} className="btn-ghost text-xs" onClick={() => send(q.text)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  {m.title && <div className="mb-1 font-semibold">{m.title}</div>}
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.chart && m.chart.length > 0 && (
                    <div className="mt-3 rounded-surface bg-white p-2 dark:bg-slate-900">
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={m.chart}>
                          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                          <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={10} interval="preserveStartEnd" />
                          <YAxis fontSize={10} tickFormatter={(v) => fmtMoney(v)} width={70} />
                          <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(l) => fmtMonth(String(l))} />
                          <Legend />
                          {/* The scenario used to be green and the baseline grey, which told
                              the reader the proposal was the better one before the
                              engine had said so. Two neutral hues; the numbers argue. */}
                          <Line type="monotone" dataKey="baseline" name="Keep as-is" stroke={c.muted} strokeDasharray="4 4" dot={false} />
                          <Line type="monotone" dataKey="scenario" name="This scenario" stroke={c.series[0]} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="px-1 text-[12px] text-slate-400">Projected savings balance, next 24 months</div>
                    </div>
                  )}
                  {m.source && m.role === "assistant" && (
                    <div className="mt-1.5 text-[12px] opacity-50">
                      {m.source === "engine" ? "exact math · scenario engine"
                        : m.source === "engine+ollama" ? "exact math · narrated by local AI"
                        : m.source === "ollama" ? "local AI (verify important numbers)"
                        : ""}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-[14px] bg-slate-100 px-4 py-2.5 text-sm text-slate-400 dark:bg-slate-800">
                  Crunching your numbers…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </Card>

      {/* Quick chips when conversation started */}
      {messages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q.label} className="btn-ghost !py-1 text-xs" onClick={() => send(q.text)} disabled={busy}>
              {q.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input flex-1"
          placeholder='Try "buy a house for $450k with 10% down" or "stop working for 8 months"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn-primary" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
      <p className="text-center text-[11px] text-slate-400">
        Everything runs locally. Estimates for planning — not financial advice.
      </p>
    </div>
  );
}

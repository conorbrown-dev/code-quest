import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, FlaskConical, RefreshCw, Repeat2, Users } from "lucide-react";
import { getAnonymousLearnerId } from "./analytics";

type Count = { name: string; count: number };
type Daily = { date: string; visitors: number; sessions: number; events: number };
type Summary = {
  windowDays: number;
  uniqueVisitors: number;
  sessions: number;
  returningVisitors: number;
  activeNow: number;
  activeToday: number;
  activeSevenDays: number;
  totalEvents: number;
  exerciseRuns: number;
  hookRuns: number;
  knownLearnersBeforeTracking: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  topCourses: Count[];
  topLessons: Count[];
  eventsByType: Count[];
  daily: Daily[];
};

const api = import.meta.env.VITE_API_BASE_URL ?? "";

function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: number | string;
  note?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#ddd8cf] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-[1.1px] text-[#788078]">{label}</span>
        <span className="text-[#5d886f]">{icon}</span>
      </div>
      <strong className="mt-3 block font-display text-4xl text-[#18372c]">{value}</strong>
      {note && <span className="mt-1 block text-xs text-[#777c77]">{note}</span>}
    </div>
  );
}

function RankedList({ title, values }: { title: string; values: Count[] }) {
  const max = Math.max(...values.map((item) => item.count), 1);
  return (
    <section className="rounded-xl border border-[#ddd8cf] bg-white p-5 shadow-sm">
      <h2 className="font-display text-xl font-semibold text-[#18372c]">{title}</h2>
      <div className="mt-4 grid gap-3">
        {values.length === 0 && <p className="text-sm text-[#777c77]">No activity yet.</p>}
        {values.map((item) => (
          <div key={item.name}>
            <div className="mb-1 flex items-center justify-between gap-4 text-xs">
              <span className="truncate text-[#4b554f]">{item.name}</span>
              <strong className="text-[#18372c]">{item.count}</strong>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e9ece8]">
              <div
                className="h-full rounded-full bg-[#5d886f]"
                style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnalyticsDashboard() {
  const [key, setKey] = useState(() => sessionStorage.getItem("pathway-analytics-key") ?? "");
  const [days, setDays] = useState(30);
  const [excludeSelf, setExcludeSelf] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ days: String(days) });
    if (excludeSelf) params.set("excludeLearnerId", getAnonymousLearnerId());
    return params.toString();
  }, [days, excludeSelf]);

  const load = async () => {
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${api}/api/admin/analytics?${query}`, {
        headers: { "X-Pathway-Analytics-Key": key },
      });
      if (response.status === 401) throw new Error("That analytics key was not accepted.");
      if (!response.ok) throw new Error("The analytics service is unavailable.");
      const next = (await response.json()) as Summary;
      sessionStorage.setItem("pathway-analytics-key", key);
      setSummary(next);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (key) void load();
    // Only auto-load when the time window/self filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-5 py-8 text-[#28322d] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col gap-5 border-b border-[#d9d4ca] pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <a href="/" className="text-xs font-bold uppercase tracking-[1.2px] text-[#5d886f]">← Pathway</a>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-1.5px] text-[#18372c] sm:text-5xl">
              Usage analytics
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#67706a]">
              First-party anonymous activity only. No raw IP addresses, browser fingerprints, advertising IDs, or referrer history.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold text-[#59635c]">
              Window
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="mt-1 block rounded-md border border-[#cfc9be] bg-white px-3 py-2 text-sm font-normal"
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>365 days</option>
              </select>
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-[#cfc9be] bg-white px-3 text-xs text-[#59635c]">
              <input
                type="checkbox"
                checked={excludeSelf}
                onChange={(event) => setExcludeSelf(event.target.checked)}
              />
              Exclude this browser
            </label>
            <button
              onClick={() => void load()}
              disabled={!key || loading}
              className="flex h-10 items-center gap-2 rounded-md bg-[#18372c] px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {!key && (
          <section className="mt-8 max-w-xl rounded-xl border border-[#ddd8cf] bg-white p-6 shadow-sm">
            <h2 className="font-display text-2xl font-semibold text-[#18372c]">Enter analytics key</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#67706a]">
              This dashboard is private and the key is kept only in this browser tab.
            </p>
            <div className="mt-5 flex gap-2">
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void load()}
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-[#cfc9be] px-3 py-2 font-mono text-sm outline-none focus:border-[#5d886f]"
              />
              <button onClick={() => void load()} className="rounded-md bg-[#18372c] px-4 py-2 text-xs font-bold text-white">
                Open
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-6 rounded-lg border border-[#e7c2b7] bg-[#fff5f2] p-4 text-sm text-[#a24f39]">{error}</div>
        )}

        {summary && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <Stat label="Unique visitors" value={summary.uniqueVisitors} note={`${summary.windowDays}-day window`} icon={<Users size={18} />} />
              <Stat label="Sessions" value={summary.sessions} icon={<Activity size={18} />} />
              <Stat label="Returning" value={summary.returningVisitors} icon={<Repeat2 size={18} />} />
              <Stat label="Active now" value={summary.activeNow} note="last 15 minutes" icon={<Activity size={18} />} />
              <Stat label="Exercise runs" value={summary.exerciseRuns} icon={<BookOpen size={18} />} />
              <Stat label="Hook runs" value={summary.hookRuns} icon={<FlaskConical size={18} />} />
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-3">
              <Stat label="Active today" value={summary.activeToday} note="last 24 hours" icon={<Users size={18} />} />
              <Stat label="Active 7 days" value={summary.activeSevenDays} icon={<Users size={18} />} />
              <Stat label="Known learners before tracking" value={summary.knownLearnersBeforeTracking} note="progress or submission records" icon={<Users size={18} />} />
            </section>

            <section className="mt-6 rounded-xl border border-[#ddd8cf] bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-xl font-semibold text-[#18372c]">Daily visitors</h2>
                <span className="text-xs text-[#777c77]">{summary.totalEvents} events total</span>
              </div>
              <div className="mt-5 flex h-44 items-end gap-1 overflow-hidden">
                {summary.daily.map((day) => {
                  const max = Math.max(...summary.daily.map((item) => item.visitors), 1);
                  const height = Math.max(3, (day.visitors / max) * 100);
                  return (
                    <div key={day.date} className="group relative flex min-w-0 flex-1 items-end">
                      <div
                        title={`${day.date}: ${day.visitors} visitors, ${day.sessions} sessions, ${day.events} events`}
                        className="w-full rounded-t bg-[#5d886f] opacity-80 transition group-hover:opacity-100"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-[#8b918d]">
                <span>{summary.daily[0]?.date}</span>
                <span>{summary.daily.at(-1)?.date}</span>
              </div>
            </section>

            <section className="mt-6 grid gap-4 xl:grid-cols-3">
              <RankedList title="Top courses" values={summary.topCourses} />
              <RankedList title="Top lessons" values={summary.topLessons} />
              <RankedList title="Event mix" values={summary.eventsByType} />
            </section>

            <p className="mt-6 text-xs text-[#858b87]">
              First tracked activity: {summary.firstSeenAt ? new Date(summary.firstSeenAt).toLocaleString() : "none"} ·
              Last activity: {summary.lastSeenAt ? new Date(summary.lastSeenAt).toLocaleString() : "none"}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

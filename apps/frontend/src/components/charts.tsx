"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  color: "var(--fg)",
  fontSize: 12,
};

export interface TrendPoint {
  ts: string;
  avgResponseMs: number | null;
  uptimePct: number | null;
}

export function ChartEmpty({ message = "No data in this range yet" }: { message?: string }) {
  return (
    <div className="grid h-full min-h-40 place-items-center text-sm text-muted" role="img" aria-label={message}>
      {message}
    </div>
  );
}

export function ResponseTrendChart({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty />;
  const rows = data.map((d) => ({
    time: new Date(d.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    avg: d.avgResponseMs,
    uptime: d.uptimePct,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
        <XAxis dataKey="time" stroke="var(--muted)" fontSize={11} tickLine={false} minTickGap={24} />
        <YAxis yAxisId="ms" stroke="var(--muted)" fontSize={11} tickLine={false} width={56} unit=" ms" />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} stroke="var(--muted)" fontSize={11} tickLine={false} width={48} unit="%" />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
        <Line yAxisId="ms" type="monotone" dataKey="avg" name="Avg response" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="pct" type="monotone" dataKey="uptime" name="Uptime %" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DistributionChart({
  data,
  color = "#38bdf8",
  height = 240,
}: {
  data: { label: string; count: number }[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.count === 0)) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} stroke="var(--muted)" fontSize={11} tickLine={false} />
        <YAxis type="category" dataKey="label" width={130} stroke="var(--muted)" fontSize={11} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="count" name="Count" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  boxShadow: "var(--shadow-raised-value)",
  color: "var(--fg)",
  fontSize: 12,
  padding: "8px 10px",
};

const axisTick = { fill: "var(--muted)", fontSize: 11 };

export interface TrendPoint {
  ts: string;
  avgResponseMs: number | null;
  uptimePct: number | null;
}

export function ChartEmpty({ message = "No data in this range yet" }: { message?: string }) {
  return (
    <div className="grid h-full min-h-40 place-items-center px-4 text-center text-sm text-muted" role="img" aria-label={message}>
      {message}
    </div>
  );
}

/**
 * Response time (ms) and uptime (%) share one timeline. A hidden table gives
 * screen-reader users the same information as the visual series.
 */
export function ResponseTrendChart({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty />;
  const rows = data.map((point) => ({
    time: new Date(point.ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    avg: point.avgResponseMs,
    uptime: point.uptimePct,
  }));
  const summary = rows
    .slice(-6)
    .map((row) => `${row.time}: ${row.avg ?? "no"} ms, ${row.uptime ?? "no"}% uptime`)
    .join("; ");

  return (
    <figure className="m-0" aria-label="Monitoring response time and uptime trend">
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="time" tick={axisTick} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis yAxisId="ms" tick={axisTick} tickLine={false} axisLine={false} width={52} unit=" ms" />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={44}
              unit="%"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
              labelStyle={{ color: "var(--fg)", fontWeight: 600 }}
              itemStyle={{ color: "var(--muted)" }}
            />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 11, color: "var(--muted)", paddingTop: 6 }}
            />
            <Line
              yAxisId="ms"
              type="monotone"
              dataKey="avg"
              name="Avg response"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="uptime"
              name="Uptime %"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

export function DistributionChart({
  data,
  color = "var(--accent)",
  height = 240,
  labelWidth = 130,
}: {
  data: { label: string; count: number }[];
  color?: string;
  height?: number;
  labelWidth?: number;
}) {
  if (data.every((entry) => entry.count === 0)) return <ChartEmpty />;
  const top = Math.max(...data.map((entry) => entry.count));
  const total = data.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <figure className="m-0" aria-label="Distribution chart">
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 28, bottom: 2, left: 4 }} barCategoryGap={6}>
            <CartesianGrid stroke="var(--line)" horizontal={false} />
            <XAxis type="number" allowDecimals={false} domain={[0, Math.max(1, top)]} tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={labelWidth}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: "var(--surface-2)" }}
              formatter={(value) => [String(value ?? ""), "Count"]}
            />
            <Bar dataKey="count" name="Count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18}>
              <LabelList dataKey="count" position="right" fill="var(--muted)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {data.map((entry) => `${entry.label}: ${entry.count}`).join(", ")}. Total {total}.
      </figcaption>
    </figure>
  );
}

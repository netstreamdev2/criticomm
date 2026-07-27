'use client';

/**
 * Shared recharts wrappers (client-only). Colors follow the dataviz-friendly
 * palette used by the severity tokens; containers are fully responsive.
 */
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

const GRID = 'rgba(148, 163, 184, 0.15)';
const TICK = { fill: 'rgba(148, 163, 184, 0.9)', fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: '#111827',
  border: '1px solid rgba(148,163,184,0.25)',
  borderRadius: 8,
  fontSize: 12,
};

export const CHART_COLORS = ['#38bdf8', '#f59e0b', '#ef4444', '#22c55e', '#a78bfa', '#f472b6'];

export function HourlyAreaChart({ data }: { data: Array<{ hour: string; calls: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <defs>
          <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="hour" tick={TICK} tickLine={false} axisLine={false} interval={3} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="calls" stroke="#38bdf8" strokeWidth={2} fill="url(#callsFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SeverityDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  const SEV_COLORS: Record<string, string> = {
    Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444',
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data} dataKey="value" nameKey="name"
          innerRadius="55%" outerRadius="85%" paddingAngle={3} strokeWidth={0}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={SEV_COLORS[d.name] ?? '#38bdf8'} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({
  data, xKey, yKey, color = '#38bdf8', height = 240,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiBarChart({
  data, xKey, series, height = 260,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key} dataKey={s.key} name={s.label}
            fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            radius={[4, 4, 0, 0]} maxBarSize={36}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

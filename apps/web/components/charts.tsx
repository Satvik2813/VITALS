'use client';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Metrics, Patient, VitalKey } from '../lib/types';
export function TrendChart({ patient, vital }: { patient: Patient; vital: VitalKey }) {
  const history = patient.history
    .slice(-30)
    .map((row, i) => ({ ...row, minute: i - Math.min(patient.history.length, 30) + 1 }));
  const value = patient.risk.baseline[vital].value;
  const color = vital === 'spo2' ? '#168873' : vital === 'heart_rate' ? '#cd655b' : '#6683c2';
  return (
    <div className="trend-chart" role="img" aria-label={`${vital} trend with baseline ${value}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ left: -20, right: 12, top: 14, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${vital}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eaf0ed" strokeDasharray="4 4" />
          <XAxis
            dataKey="minute"
            tickFormatter={(v) => `${v}m`}
            tick={{ fontSize: 12, fill: '#71847f' }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 12, fill: '#71847f' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ borderRadius: 10, fontSize: 13 }}
            labelFormatter={(v) => `${v} simulated minutes from latest`}
          />
          <ReferenceLine y={value} stroke="#96aba2" strokeDasharray="5 5" />
          <Area
            dataKey={vital}
            type="monotone"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#fill-${vital})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function BurdenChart({ metrics }: { metrics: Metrics }) {
  return (
    <div className="burden-chart" role="img" aria-label="Computed cumulative naive and VITALIS alert counts">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={metrics.history} margin={{ left: -20, right: 15, top: 10, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eaf0ed" />
          <XAxis
            dataKey="minute"
            tickFormatter={(v) => `${v}m`}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#71847f' }}
            minTickGap={40}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#71847f' }} />
          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
          <Line
            name="Naive alerts"
            dataKey="naive"
            stroke="#bd8d78"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="VITALIS events"
            dataKey="vitalis"
            stroke="#17846a"
            strokeWidth={3}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

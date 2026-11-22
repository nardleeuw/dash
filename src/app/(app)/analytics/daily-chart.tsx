"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Validated categorical slots 1–3 (light surface): blue, orange, aqua.
// Aqua is < 3:1 on white → relief via legend + table view.
const SERIES = [
  { key: "sent", color: "#2a78d6" },
  { key: "replies", color: "#eb6834" },
  { key: "positive", color: "#1baf7a" },
] as const;

type Point = { day: string; sent: number; replies: number; positive: number };

export function DailyChart({ data, labels, locale }: { data: Point[]; labels: Record<"sent" | "replies" | "positive", string>; locale: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const fmtDay = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(d));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: s.color }} />{labels[s.key]}</span>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5">
          <button onClick={() => setView("chart")} className={`rounded px-1.5 py-1 ${view === "chart" ? "bg-secondary" : ""}`} aria-label="chart"><LineIcon className="size-3.5" /></button>
          <button onClick={() => setView("table")} className={`rounded px-1.5 py-1 ${view === "table" ? "bg-secondary" : ""}`} aria-label="table"><Table2 className="size-3.5" /></button>
        </div>
      </div>
      {view === "chart" ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                labelFormatter={(d) => fmtDay(String(d))}
                formatter={(v, name) => [v, labels[name as keyof typeof labels] ?? name]}
                contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, boxShadow: "0 4px 12px rgba(16,24,40,.08)" }}
              />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead /> {SERIES.map((s) => <TableHead key={s.key} className="text-right">{labels[s.key]}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {data.filter((d) => d.sent || d.replies).map((d) => (
                <TableRow key={d.day}><TableCell className="text-sm">{fmtDay(d.day)}</TableCell>{SERIES.map((s) => <TableCell key={s.key} className="text-right tabular">{d[s.key]}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

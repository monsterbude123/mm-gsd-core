import { useMemo, useState } from "react";
import type { ToolTelemetry } from "../types.ts";

interface TelemetryViewProps {
  telemetry: ToolTelemetry;
}

export function TelemetryView({ telemetry }: TelemetryViewProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const sortedTools = useMemo(
    () =>
      Object.entries(telemetry.byTool).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
      ),
    [telemetry.byTool]
  );

  if (telemetry.empty || telemetry.series.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#0F1522]">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          本项目暂无工具遥测记录
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          看板只读取本机 ~/.agents/mm-gsd-tools.jsonl，不向外部发任何请求。完成一次检查器或工具调用后将按本地日切桶展示。
        </p>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...telemetry.series.map((s) => s.count));
  const peakDay = telemetry.series.reduce(
    (best, cur) => (cur.count > best.count ? cur : best),
    telemetry.series[0]
  );
  const activeDay =
    hoveredIdx !== null ? telemetry.series[hoveredIdx] : peakDay;

  const W = 680;
  const H = 260;
  const padL = 40;
  const padR = 16;
  const padT = 20;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const stepX = innerW / telemetry.series.length;
  const barW = Math.max(12, Math.min(40, stepX * 0.56));

  const yTicks = [0, Math.round(maxDaily / 2), maxDaily];

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <EfficiencyCard telemetry={telemetry} />
      <section className="grid grid-cols-1 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            累计本机调用
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
            {telemetry.total}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            统计跨度
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
            {telemetry.series.length} 天
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {hoveredIdx !== null ? "当前悬停日" : "单日峰值"} ({activeDay.date})
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
            {activeDay.count} 次
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                按本地自然日调用分布
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                悬停柱状查看单日精准调用次数 · 数据源 ~/.agents/mm-gsd-tools.jsonl
              </p>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full min-w-[460px]"
              role="img"
              aria-label="按天工具调用柱状图"
            >
              {yTicks.map((val) => {
                const y = padT + innerH - (val / maxDaily) * innerH;
                return (
                  <g key={val}>
                    <line
                      x1={padL}
                      x2={W - padR}
                      y1={y}
                      y2={y}
                      strokeWidth={1}
                      className="stroke-slate-200 dark:stroke-slate-800"
                    />
                    <text
                      x={padL - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 font-mono text-[10px] tabular-nums"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {telemetry.series.map((d, i) => {
                const h = Math.max(4, (d.count / maxDaily) * innerH);
                const x = padL + i * stepX + (stepX - barW) / 2;
                const y = padT + innerH - h;
                const isHovered = hoveredIdx === i;

                return (
                  <g
                    key={d.date}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={4}
                      className={
                        isHovered
                          ? "fill-emerald-500 transition-colors"
                          : "fill-blue-500/75 hover:fill-emerald-500 transition-colors dark:fill-blue-400/70"
                      }
                    />
                    {(i === 0 ||
                      i === telemetry.series.length - 1 ||
                      i % Math.ceil(telemetry.series.length / 5) === 0 ||
                      isHovered) && (
                      <text
                        x={x + barW / 2}
                        y={H - 10}
                        textAnchor="middle"
                        className={`font-mono text-[10px] ${
                          isHovered
                            ? "fill-slate-900 font-semibold dark:fill-white"
                            : "fill-slate-400"
                        }`}
                      >
                        {d.date.slice(5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              工具调用分布排行
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {sortedTools.length} 种
            </span>
          </div>

          <div className="space-y-3.5">
            {sortedTools.map(([tool, count]) => {
              const pct = Math.round((count / Math.max(1, telemetry.total)) * 100);
              const barPct = Math.round(
                (count / Math.max(1, sortedTools[0][1])) * 100
              );
              return (
                <div key={tool} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                      {tool}
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                      {count} 次 ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * 执行效率摘要卡片(34-02,/api/state.telemetry 的 efficiency/runs 字段):
 * 检查器耗时 P50/P95、Agent resume 复用率(不可得时明说,不显示 0%)、同路径重复读热点。
 * 两个数据块都可能缺(历史行无 duration_ms/target_path,或服务端旧版):都缺就整卡不渲染。
 */
function EfficiencyCard({ telemetry }: TelemetryViewProps) {
  const eff = telemetry.efficiency;
  const runs = telemetry.runs;
  if (!eff && !runs) return null;
  const thrash = eff?.thrash ?? [];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0F1522]">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          执行效率摘要
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          检查器耗时与子代理复用 · 观测面不判红 · 数据源 ~/.agents/mm-gsd-runs.jsonl 与
          ~/.agents/mm-gsd-tools.jsonl
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            检查器耗时 P50 / P95
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums dark:text-white">
            {runs && runs.measured > 0
              ? `${runs.p50}ms / ${runs.p95}ms`
              : "暂无数据"}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {runs && runs.measured > 0
              ? `${runs.measured} 次含时长 · 最慢 ${runs.slow[0]?.duration_ms ?? "—"}ms (${runs.slow[0]?.mode ?? "—"})`
              : "duration_ms 自 34-02 起采集"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Agent resume 复用率
          </div>
          <div
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              eff?.reuseRate == null
                ? "text-slate-400 dark:text-slate-500"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {eff?.reuseRate == null ? "不可得" : `${eff.reuseRate}%`}
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {eff?.reuseRate == null
              ? "工具入参未观测到续跑来源键,不计 0%"
              : `${eff.resumed}/${eff.agents} 次派发为 resume`}
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            同路径重复读(context-thrash)
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums dark:text-white">
            {eff ? eff.thrashAll : 0} 处
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Read≥3 次/会话 · cwd×路径分组 · 30 分钟无活动切会话
          </div>
        </div>
      </div>
      {thrash.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            重复读热点(列前 {thrash.length} 处)
          </div>
          {thrash.map((t) => (
            <div
              key={`${t.cwd}:${t.path}`}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="truncate font-mono text-slate-800 dark:text-slate-200">
                {t.path}
                <span className="ml-2 text-slate-400">{t.cwd}</span>
              </span>
              <span className="font-mono text-amber-600 tabular-nums dark:text-amber-400">
                {t.reads}×
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

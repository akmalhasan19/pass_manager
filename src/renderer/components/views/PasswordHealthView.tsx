import { useState, useEffect, useCallback } from 'react';
import type { HealthReport } from '../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTranslation } from '../../i18n/useTranslation';

interface PasswordHealthViewProps {
  onSelectItem?: (id: string) => void;
}

const SCORE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  A: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-500',
  },
  B: {
    bg: 'bg-sky-100 dark:bg-sky-900/40',
    text: 'text-sky-700 dark:text-sky-300',
    ring: 'ring-sky-500',
  },
  C: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-700 dark:text-amber-300',
    ring: 'ring-amber-500',
  },
  D: {
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    text: 'text-orange-700 dark:text-orange-300',
    ring: 'ring-orange-500',
  },
  F: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-500',
  },
};

const SCORE_LABELS: Record<string, string> = {
  A: 'health.score.excellent',
  B: 'health.score.good',
  C: 'health.score.fair',
  D: 'health.score.poor',
  F: 'health.score.critical',
};

interface StatCardProps {
  label: string;
  value: number;
  icon: string;
  color: string;
  total?: number;
}

function StatCard({ label, value, icon, color, total }: StatCardProps) {
  return (
    <div className="notion-card flex items-center gap-3 p-4">
      <div
        className={`h-10 w-10 rounded-lg ${color} flex shrink-0 items-center justify-center text-lg`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold tabular-nums text-surface-900 dark:text-white">
          {value}
          {total !== undefined && (
            <span className="ml-1 text-sm font-normal text-surface-400 dark:text-surface-500">
              / {total}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-surface-500 dark:text-surface-400">{label}</div>
      </div>
    </div>
  );
}

interface LoadingSkeletonProps {
  lines?: number;
}

function LoadingSkeleton({ lines = 4 }: LoadingSkeletonProps) {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-8 w-48 rounded bg-surface-200 dark:bg-surface-700" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-surface-200 dark:bg-surface-700" />
        ))}
      </div>
      {[...Array(lines)].map((_, i) => (
        <div key={i} className="h-20 rounded-lg bg-surface-200 dark:bg-surface-700" />
      ))}
    </div>
  );
}

const CHART_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#f97316'];

function Gobtn({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      className="notion-button-ghost h-7 shrink-0 gap-1 text-xs"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
      {t('health.goToItem')}
    </button>
  );
}

export default function PasswordHealthView({
  onSelectItem,
}: PasswordHealthViewProps): React.ReactElement {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useSettingsStore();
  const { t } = useTranslation();

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.health.analyze(settings.passwordHealthOldDays);
      if (!result.success) throw new Error(result.error || t('health.error.analyzeFailed'));
      setReport(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('health.error.analyzeFailed'));
    } finally {
      setLoading(false);
    }
  }, [settings.passwordHealthOldDays, t]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const goToItem = useCallback(
    (itemId: string) => {
      onSelectItem?.(itemId);
    },
    [onSelectItem],
  );

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="text-4xl">⚠️</div>
        <p className="text-sm text-surface-500 dark:text-surface-400">{error}</p>
        <button className="notion-button-primary h-8 text-xs" onClick={loadReport}>
          {t('health.retry')}
        </button>
      </div>
    );
  }

  if (!report || report.total === 0) {
    return (
      <div className="notion-empty-state h-full">
        <div className="notion-empty-state-icon">🛡️</div>
        <p className="notion-empty-state-title">{t('health.empty.title')}</p>
        <p className="notion-empty-state-description">
          {t('health.empty.description')}
        </p>
      </div>
    );
  }

  const color = SCORE_COLORS[report.score];
  const weakPct = Math.round((report.weak / report.total) * 100);
  const strongPct = Math.round((report.strong / report.total) * 100);
  const reusedPct = Math.round((report.reused / report.total) * 100);
  const oldPct = Math.round((report.old / report.total) * 100);

  const segments = [
    { pct: strongPct, color: CHART_COLORS[0], label: 'Strong' },
    { pct: weakPct, color: CHART_COLORS[1], label: 'Weak' },
    { pct: reusedPct, color: CHART_COLORS[2], label: 'Reused' },
    { pct: oldPct, color: CHART_COLORS[3], label: 'Outdated' },
  ].filter((s) => s.pct > 0);

  const ringR = 40;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="notion-scrollbar space-y-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">{t('health.heading')}</h1>
        <button className="notion-button-ghost h-8 gap-1.5 text-xs" onClick={loadReport}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {t('health.refresh')}
        </button>
      </div>

      <div className={`notion-card flex items-center gap-6 p-6 ${color.bg}`}>
        <div
          className={`h-20 w-20 rounded-full ring-4 ${color.ring} flex shrink-0 items-center justify-center`}
        >
          <span className={`text-3xl font-bold ${color.text}`}>{report.score}</span>
        </div>
        <div>
          <div className={`text-lg font-semibold ${color.text}`}>{t(SCORE_LABELS[report.score])}</div>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            {t('health.analyzed', { count: report.total })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label={t('health.totalPasswords')}
          value={report.total}
          icon="🔐"
          color="bg-surface-100 dark:bg-surface-800"
        />
        <StatCard
          label={t('health.strong')}
          value={report.strong}
          icon="✅"
          color="bg-emerald-100 dark:bg-emerald-900/40"
          total={report.total}
        />
        <StatCard
          label={t('health.weak')}
          value={report.weak}
          icon="⚠️"
          color="bg-red-100 dark:bg-red-900/40"
          total={report.total}
        />
        <StatCard
          label={t('health.reused')}
          value={report.reused}
          icon="♻️"
          color="bg-amber-100 dark:bg-amber-900/40"
        />
        <StatCard
          label={t('health.outdated')}
          value={report.old}
          icon="📅"
          color="bg-orange-100 dark:bg-orange-900/40"
          total={report.total}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {/* Progress bars */}
        <div className="notion-card space-y-3 p-4 md:col-span-3">
          <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300">{t('health.overview')}</h3>
          <ProgressBar label={t('health.strong')} pct={strongPct} color="bg-emerald-500" />
          <ProgressBar label={t('health.weak')} pct={weakPct} color="bg-red-500" />
          <ProgressBar label={t('health.reused')} pct={reusedPct} color="bg-amber-500" />
          <ProgressBar label={t('health.outdated')} pct={oldPct} color="bg-orange-500" />
        </div>

        {/* Donut chart */}
        <div className="notion-card flex flex-col items-center justify-center gap-3 p-4 md:col-span-2">
          <h3 className="self-start text-sm font-medium text-surface-700 dark:text-surface-300">
            {t('health.distribution')}
          </h3>
          <svg viewBox="0 0 100 100" className="h-28 w-28">
            <circle
              cx="50"
              cy="50"
              r={ringR}
              fill="none"
              stroke="currentColor"
              className="text-surface-200 dark:text-surface-700"
              strokeWidth="10"
            />
            {buildRings(50, 50, ringR, 10, segments, ringC)}
          </svg>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {segments.map((seg) => (
              <div
                key={seg.label}
                className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                {seg.label} {seg.pct}%
              </div>
            ))}
          </div>
        </div>
      </div>

      {report.weakPasswords.length > 0 && (
        <div className="notion-card p-4">
          <h3 className="mb-3 text-sm font-medium text-surface-700 dark:text-surface-300">
            {t('health.weakPasswords', { count: report.weakPasswords.length })}
          </h3>
          <div className="space-y-1">
            {report.weakPasswords.map((wp) => (
              <div
                key={wp.itemId}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                onClick={() => goToItem(wp.itemId)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-surface-900 dark:text-white">
                    {wp.title}
                  </div>
                  <div className="text-xs text-surface-400 dark:text-surface-500">{wp.reason}</div>
                </div>
                <Gobtn onClick={() => goToItem(wp.itemId)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {report.reusedPasswords.length > 0 && (
        <div className="notion-card p-4">
          <h3 className="mb-3 text-sm font-medium text-surface-700 dark:text-surface-300">
            {t('health.reusedPasswords', { count: report.reusedPasswords.length })}
          </h3>
          <div className="space-y-3">
            {report.reusedPasswords.map((rp) => (
              <div
                key={rp.hash}
                className="rounded px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800/50"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t('health.usedInItems', { count: rp.count })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rp.items.map((rpItem) => (
                    <span
                      key={rpItem.itemId}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:hover:bg-surface-700"
                      onClick={() => goToItem(rpItem.itemId)}
                    >
                      {rpItem.title}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3 w-3 opacity-50"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.oldPasswords.length > 0 && (
        <div className="notion-card p-4">
          <h3 className="mb-3 text-sm font-medium text-surface-700 dark:text-surface-300">
            {t('health.outdatedPasswords', { count: report.oldPasswords.length })}
          </h3>
          <div className="space-y-1">
            {report.oldPasswords.map((op) => (
              <div
                key={op.itemId}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                onClick={() => goToItem(op.itemId)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-surface-900 dark:text-white">
                    {op.title}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-surface-400 dark:text-surface-500">
                    {t('health.daysAgo', { days: op.daysSinceChange })}
                  </span>
                  <Gobtn onClick={() => goToItem(op.itemId)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-surface-500 dark:text-surface-400">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface RingSegment {
  pct: number;
  color: string;
  label: string;
}

function buildRings(
  cx: number,
  cy: number,
  r: number,
  sw: number,
  segments: RingSegment[],
  circumference: number,
): React.ReactNode[] {
  let offset = 0;
  return segments.map((seg) => {
    const dashLen = (seg.pct / 100) * circumference;
    const elem = (
      <circle
        key={seg.label}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={sw}
        strokeDasharray={`${dashLen} ${circumference - dashLen}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
        style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cy}px` }}
      />
    );
    offset += dashLen;
    return elem;
  });
}

const MAX_LOG_ENTRIES = 500;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

export interface AuditLogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  type: string;
  tabId?: number;
  url?: string;
  origin?: string;
  message: string;
  durationMs?: number;
  errorCode?: string;
  riskLevel?: 'normal' | 'suspicious' | 'blocked';
}

const logBuffer: AuditLogEntry[] = [];
let nextId = 1;

function addEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
  const logEntry: AuditLogEntry = {
    id: nextId++,
    timestamp: Date.now(),
    ...entry,
  };

  logBuffer.push(logEntry);

  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }

  const tag = '[SecurePass:Audit]';
  const urlInfo = entry.url ? ` (${entry.url})` : '';
  const tabInfo = entry.tabId ? ` [tab:${entry.tabId}]` : '';
  const duration = entry.durationMs !== undefined ? ` +${entry.durationMs}ms` : '';

  switch (entry.level) {
    case 'error':
      console.error(`${tag} ${entry.message}${urlInfo}${tabInfo}${duration}`, entry.errorCode ? `code=${entry.errorCode}` : '');
      break;
    case 'warn':
      console.warn(`${tag} ${entry.message}${urlInfo}${tabInfo}${duration}`);
      break;
    case 'info':
      console.info(`${tag} ${entry.message}${urlInfo}${tabInfo}${duration}`);
      break;
    default:
      console.debug(`${tag} ${entry.message}${urlInfo}${tabInfo}${duration}`);
      break;
  }
}

export function logRequest(
  type: string,
  sender: chrome.runtime.MessageSender | null,
  details?: {
    level?: LogLevel;
    message?: string;
    durationMs?: number;
    errorCode?: string;
    riskLevel?: 'normal' | 'suspicious' | 'blocked';
  },
): void {
  addEntry({
    level: details?.level ?? 'info',
    type,
    tabId: sender?.tab?.id,
    url: sender?.tab?.url ?? sender?.url,
    origin: sender?.origin,
    message: details?.message ?? `Request: ${type}`,
    durationMs: details?.durationMs,
    errorCode: details?.errorCode,
    riskLevel: details?.riskLevel,
  });
}

export function getRecentLogs(count: number = 50): AuditLogEntry[] {
  return logBuffer.slice(-count);
}

export function getLogsByTab(tabId: number, count: number = 50): AuditLogEntry[] {
  return logBuffer.filter((e) => e.tabId === tabId).slice(-count);
}

export function getLogsByType(type: string, count: number = 50): AuditLogEntry[] {
  return logBuffer.filter((e) => e.type === type).slice(-count);
}

export function getSuspiciousLogs(count: number = 50): AuditLogEntry[] {
  return logBuffer
    .filter((e) => e.riskLevel === 'suspicious' || e.riskLevel === 'blocked')
    .slice(-count);
}

export function clearLogs(): void {
  logBuffer.length = 0;
}

export function getLogStats(): { total: number; byType: Record<string, number>; byLevel: Record<string, number> } {
  const byType: Record<string, number> = {};
  const byLevel: Record<string, number> = {};

  for (const entry of logBuffer) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
  }

  return { total: logBuffer.length, byType, byLevel };
}

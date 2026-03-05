/**
 * Agent failure alerting and adapter performance tracking.
 *
 * Sends webhook alerts on failures and tracks per-adapter success/failure
 * metrics in memory for operational visibility.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertContext {
  adapter?: string;
  error?: string;
  itemCount?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface AdapterStats {
  successCount: number;
  failureCount: number;
  totalItems: number;
  totalDurationMs: number;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface AdapterStatsReport {
  successRate: number;
  totalItems: number;
  avgDurationMs: number;
  successCount: number;
  failureCount: number;
  lastRunAt: string | null;
  lastError: string | null;
}

const adapterStatsMap = new Map<string, AdapterStats>();

/**
 * Send an alert via webhook POST to the configured ALERT_WEBHOOK_URL.
 * Silently fails if no webhook URL is configured or if the request errors.
 */
export async function sendAlert(
  message: string,
  severity: AlertSeverity,
  context: AlertContext = {},
): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(`[monitoring] No ALERT_WEBHOOK_URL configured, skipping alert: ${message}`);
    return;
  }

  const payload = {
    message,
    severity,
    context,
    timestamp: new Date().toISOString(),
    source: "nexus-agent",
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `[monitoring] Alert webhook returned ${response.status}: ${await response.text()}`,
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[monitoring] Failed to send alert webhook: ${errorMessage}`);
  }
}

/**
 * Record the result of an adapter poll cycle.
 * Tracks success/failure counts, item counts, and duration for each adapter.
 */
export function trackAdapterResult(
  adapterName: string,
  success: boolean,
  itemCount: number,
  durationMs: number,
): void {
  let stats = adapterStatsMap.get(adapterName);

  if (!stats) {
    stats = {
      successCount: 0,
      failureCount: 0,
      totalItems: 0,
      totalDurationMs: 0,
      lastRunAt: null,
      lastError: null,
    };
    adapterStatsMap.set(adapterName, stats);
  }

  if (success) {
    stats.successCount++;
    stats.totalItems += itemCount;
  } else {
    stats.failureCount++;
  }

  stats.totalDurationMs += durationMs;
  stats.lastRunAt = new Date().toISOString();
}

/**
 * Record a failure with an error message for the given adapter.
 */
export function trackAdapterFailure(adapterName: string, error: string): void {
  let stats = adapterStatsMap.get(adapterName);

  if (!stats) {
    stats = {
      successCount: 0,
      failureCount: 0,
      totalItems: 0,
      totalDurationMs: 0,
      lastRunAt: null,
      lastError: null,
    };
    adapterStatsMap.set(adapterName, stats);
  }

  stats.lastError = error;
}

/**
 * Returns per-adapter performance stats as a plain object keyed by adapter name.
 */
export function getAdapterStats(): Record<string, AdapterStatsReport> {
  const result: Record<string, AdapterStatsReport> = {};

  for (const [name, stats] of adapterStatsMap) {
    const totalRuns = stats.successCount + stats.failureCount;
    result[name] = {
      successRate: totalRuns > 0 ? stats.successCount / totalRuns : 0,
      totalItems: stats.totalItems,
      avgDurationMs: totalRuns > 0 ? Math.round(stats.totalDurationMs / totalRuns) : 0,
      successCount: stats.successCount,
      failureCount: stats.failureCount,
      lastRunAt: stats.lastRunAt,
      lastError: stats.lastError,
    };
  }

  return result;
}

/**
 * Reset all adapter stats. Useful for testing.
 */
export function resetAdapterStats(): void {
  adapterStatsMap.clear();
}

/**
 * Graph anomaly detection.
 *
 * Statistical anomaly detection for node counts and event rates
 * using z-score analysis against a rolling historical window.
 * Flags deviations greater than 2 standard deviations.
 */

const TWO_SIGMA_THRESHOLD = 2;
const ROLLING_WINDOW_DAYS = 7;
const HOURS_PER_DAY = 24;

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  message: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
}

/**
 * Check whether a current node count is anomalous compared to historical counts.
 * Returns an anomaly result if the delta exceeds 2 standard deviations.
 */
export function checkNodeCountAnomaly(
  currentCount: number,
  historicalCounts: number[],
): AnomalyResult {
  if (historicalCounts.length < 2) {
    return {
      isAnomaly: false,
      zScore: 0,
      message: "Insufficient historical data for anomaly detection",
    };
  }

  const avg = mean(historicalCounts);
  const stdDev = standardDeviation(historicalCounts);

  if (stdDev === 0) {
    const isAnomaly = currentCount !== avg;
    return {
      isAnomaly,
      zScore: isAnomaly ? Infinity : 0,
      message: isAnomaly
        ? `Node count ${currentCount} deviates from constant historical value ${avg}`
        : "Node count is consistent with historical values",
    };
  }

  const zScore = Math.abs((currentCount - avg) / stdDev);
  const isAnomaly = zScore > TWO_SIGMA_THRESHOLD;

  return {
    isAnomaly,
    zScore: Math.round(zScore * 100) / 100,
    message: isAnomaly
      ? `Node count ${currentCount} is ${zScore.toFixed(2)} standard deviations from mean ${avg.toFixed(1)} (σ=${stdDev.toFixed(1)})`
      : `Node count ${currentCount} is within normal range (z=${zScore.toFixed(2)}, mean=${avg.toFixed(1)})`,
  };
}

/**
 * Check whether the current event rate (events per hour) is anomalous
 * compared to a historical series of hourly rates.
 */
export function checkEventRate(eventsPerHour: number[], currentRate: number): AnomalyResult {
  if (eventsPerHour.length < 2) {
    return {
      isAnomaly: false,
      zScore: 0,
      message: "Insufficient historical data for event rate anomaly detection",
    };
  }

  const avg = mean(eventsPerHour);
  const stdDev = standardDeviation(eventsPerHour);

  if (stdDev === 0) {
    const isAnomaly = currentRate !== avg;
    return {
      isAnomaly,
      zScore: isAnomaly ? Infinity : 0,
      message: isAnomaly
        ? `Event rate ${currentRate}/hr deviates from constant historical rate ${avg}/hr`
        : "Event rate is consistent with historical values",
    };
  }

  const zScore = Math.abs((currentRate - avg) / stdDev);
  const isAnomaly = zScore > TWO_SIGMA_THRESHOLD;

  return {
    isAnomaly,
    zScore: Math.round(zScore * 100) / 100,
    message: isAnomaly
      ? `Event rate ${currentRate}/hr is ${zScore.toFixed(2)} standard deviations from mean ${avg.toFixed(1)}/hr (σ=${stdDev.toFixed(1)})`
      : `Event rate ${currentRate}/hr is within normal range (z=${zScore.toFixed(2)}, mean=${avg.toFixed(1)}/hr)`,
  };
}

/**
 * Tracks rolling counts over a 7-day window and checks for anomalies
 * on each mutation batch.
 */
export class AnomalyDetector {
  private readonly nodeCountHistory: number[] = [];
  private readonly eventRateHistory: number[] = [];
  private readonly maxHistoryLength: number;

  constructor(maxHistoryLength: number = ROLLING_WINDOW_DAYS * HOURS_PER_DAY) {
    this.maxHistoryLength = maxHistoryLength;
  }

  /**
   * Record a snapshot of the current node count.
   * Trims history to the rolling window size.
   */
  recordNodeCount(count: number): void {
    this.nodeCountHistory.push(count);
    if (this.nodeCountHistory.length > this.maxHistoryLength) {
      this.nodeCountHistory.shift();
    }
  }

  /**
   * Record a snapshot of the current event rate (events per hour).
   * Trims history to the rolling window size.
   */
  recordEventRate(rate: number): void {
    this.eventRateHistory.push(rate);
    if (this.eventRateHistory.length > this.maxHistoryLength) {
      this.eventRateHistory.shift();
    }
  }

  /**
   * Check a mutation batch for anomalies against the rolling history.
   * Returns anomaly results for both node count and event rate.
   */
  checkBatch(
    currentNodeCount: number,
    currentEventRate: number,
  ): {
    nodeCountAnomaly: AnomalyResult;
    eventRateAnomaly: AnomalyResult;
  } {
    const nodeCountAnomaly = checkNodeCountAnomaly(currentNodeCount, this.nodeCountHistory);
    const eventRateAnomaly = checkEventRate(this.eventRateHistory, currentEventRate);

    // Record current values into history after checking
    this.recordNodeCount(currentNodeCount);
    this.recordEventRate(currentEventRate);

    return { nodeCountAnomaly, eventRateAnomaly };
  }

  /**
   * Returns the number of recorded data points for node counts.
   */
  getNodeCountHistoryLength(): number {
    return this.nodeCountHistory.length;
  }

  /**
   * Returns the number of recorded data points for event rates.
   */
  getEventRateHistoryLength(): number {
    return this.eventRateHistory.length;
  }

  /**
   * Reset all recorded history. Useful for testing.
   */
  reset(): void {
    this.nodeCountHistory.length = 0;
    this.eventRateHistory.length = 0;
  }
}

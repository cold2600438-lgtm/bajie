// ============================================================
// Cost Calculator: Generate cost reports based on usage and pricing
// ============================================================

import { getDatabase } from '../db/database.js';
import type { CostReport, CostReportEntry, TimeRange } from '../types/index.js';

interface RawUsageRow {
  user_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
}

interface RawPricingRow {
  prompt_price_per_k_token: number;
  completion_price_per_k_token: number;
}

export class CostCalculator {
  /**
   * 生成费用报告：查询时间范围内的用量，结合 Provider 定价计算每用户费用。
   */
  generateReport(timeRange: TimeRange): CostReport {
    const db = getDatabase();

    // Query token_usage grouped by user_id and provider_id
    const usageRows = db.prepare(`
      SELECT
        user_id,
        provider_id,
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens
      FROM token_usage
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY user_id, provider_id
    `).all(
      this.formatDate(timeRange.start),
      this.formatDate(timeRange.end),
    ) as RawUsageRow[];

    const entries: CostReportEntry[] = [];
    let totalCost = 0;

    for (const row of usageRows) {
      // Look up provider pricing
      const pricing = db.prepare(`
        SELECT prompt_price_per_k_token, completion_price_per_k_token
        FROM providers
        WHERE id = ?
      `).get(row.provider_id) as RawPricingRow | undefined;

      const promptPrice = pricing?.prompt_price_per_k_token ?? 0;
      const completionPrice = pricing?.completion_price_per_k_token ?? 0;

      const promptCost = row.prompt_tokens * promptPrice / 1000;
      const completionCost = row.completion_tokens * completionPrice / 1000;
      const entryCost = promptCost + completionCost;

      entries.push({
        userId: row.user_id,
        provider: row.provider_id,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        promptCost,
        completionCost,
        totalCost: entryCost,
      });

      totalCost += entryCost;
    }

    return { timeRange, entries, totalCost };
  }

  private formatDate(d: Date): string {
    return d.toISOString().replace('T', ' ').replace('Z', '');
  }
}

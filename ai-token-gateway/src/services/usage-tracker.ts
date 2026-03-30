// ============================================================
// Usage Tracker: Record and query token usage
// ============================================================

import { getDatabase } from '../db/database.js';
import type { UsageEntry, UsageSummary, TimeRange } from '../types/index.js';

export class UsageTracker {
  /**
   * 记录一次请求的 token 用量到 token_usage 表。
   */
  record(entry: UsageEntry): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.userId,
      entry.provider,
      entry.apiKeyId,
      entry.model,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      entry.timestamp.toISOString().replace('T', ' ').replace('Z', ''),
    );
  }

  /**
   * 查询指定用户的用量汇总，按天/周/月粒度分组。
   */
  getUserUsage(
    userId: string,
    timeRange: TimeRange,
    granularity: 'day' | 'week' | 'month',
  ): UsageSummary[] {
    const db = getDatabase();
    const periodExpr = this.getPeriodExpression(granularity);
    const stmt = db.prepare(`
      SELECT
        user_id,
        provider_id,
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        SUM(total_tokens) AS total_tokens,
        ${periodExpr} AS period
      FROM token_usage
      WHERE user_id = ?
        AND created_at >= ?
        AND created_at <= ?
      GROUP BY user_id, provider_id, period
      ORDER BY period
    `);
    const rows = stmt.all(
      userId,
      this.formatDate(timeRange.start),
      this.formatDate(timeRange.end),
    ) as RawUsageRow[];
    return rows.map(this.mapRow);
  }

  /**
   * 查询所有用户的用量汇总（管理员），按月粒度分组。
   */
  getAllUsage(timeRange: TimeRange): UsageSummary[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT
        user_id,
        provider_id,
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        SUM(total_tokens) AS total_tokens,
        strftime('%Y-%m', created_at) AS period
      FROM token_usage
      WHERE created_at >= ?
        AND created_at <= ?
      GROUP BY user_id, provider_id, period
      ORDER BY period
    `);
    const rows = stmt.all(
      this.formatDate(timeRange.start),
      this.formatDate(timeRange.end),
    ) as RawUsageRow[];
    return rows.map(this.mapRow);
  }

  // --- private helpers ---

  private getPeriodExpression(granularity: 'day' | 'week' | 'month'): string {
    switch (granularity) {
      case 'day':
        return "date(created_at)";
      case 'week':
        return "strftime('%Y-W%W', created_at)";
      case 'month':
        return "strftime('%Y-%m', created_at)";
    }
  }

  private formatDate(d: Date): string {
    return d.toISOString().replace('T', ' ').replace('Z', '');
  }

  private mapRow(row: RawUsageRow): UsageSummary {
    return {
      userId: row.user_id,
      provider: row.provider_id,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      period: row.period,
    };
  }
}

interface RawUsageRow {
  user_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  period: string;
}

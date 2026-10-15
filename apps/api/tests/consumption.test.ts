import { describe, expect, it, vi } from 'vitest';
import {
  getGenerationCredits,
  listConsumptionSettings,
  setVideoModelConsumptionAvailabilityWithClient,
} from '../src/domain/consumption.js';

describe('积分消耗配置', () => {
  it('生成预扣只读取可用的视频配置', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ credits: 88, reference_video_credits: 54 }] });
    const credits = await getGenerationCredits({ query } as any, {
      kind: 'video',
      model: 'Seedance 2.0',
      durationSeconds: 15,
      resolution: '720p',
    });

    expect(credits).toBe(88);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('available = true'),
      ['Seedance 2.0', 15, '720p'],
    );

    await expect(getGenerationCredits({ query } as any, {
      kind: 'video',
      model: 'Seedance 2.0',
      durationSeconds: 15,
      resolution: '720p',
      hasReferenceVideo: true,
    })).resolves.toBe(54);
  });

  it('查不到可用配置时返回 0，生成任务会被上层拒绝', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const credits = await getGenerationCredits({ query } as any, {
      kind: 'video',
      model: 'Seedance 2.0 Fast',
      durationSeconds: 15,
      resolution: '1080p',
    });

    expect(credits).toBe(0);
  });

  it('Seedance 2.5 直连生成只有 12 档全开放且双档正价时才返回积分', async () => {
    const completeRows = seedance25Rows(true);
    const completeQuery = vi.fn().mockResolvedValue({ rowCount: 12, rows: completeRows });
    await expect(getGenerationCredits({ query: completeQuery } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 25, resolution: '720p',
    })).resolves.toBe(204);
    await expect(getGenerationCredits({ query: completeQuery } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 30, resolution: '720p',
    })).resolves.toBe(244);
    await expect(getGenerationCredits({ query: completeQuery } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 30, resolution: '720p',
      hasReferenceVideo: true,
    })).resolves.toBe(147);
    expect(completeQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE kind = 'video' AND model = $1"),
      ['Seedance 2.5'],
    );

    const partialRows = seedance25Rows(true);
    partialRows[0] = { ...partialRows[0]!, available: false };
    await expect(getGenerationCredits({
      query: vi.fn().mockResolvedValue({ rowCount: 12, rows: partialRows }),
    } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 30, resolution: '720p',
    })).resolves.toBe(0);

    const zeroPriceRows = seedance25Rows(true);
    zeroPriceRows[11] = { ...zeroPriceRows[11]!, reference_video_credits: 0 };
    await expect(getGenerationCredits({
      query: vi.fn().mockResolvedValue({ rowCount: 12, rows: zeroPriceRows }),
    } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 5, resolution: '480p',
    })).resolves.toBe(0);

    await expect(getGenerationCredits({
      query: vi.fn().mockResolvedValue({ rowCount: 11, rows: completeRows.slice(0, 11) }),
    } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 5, resolution: '480p',
    })).resolves.toBe(0);

    await expect(getGenerationCredits({
      query: vi.fn().mockResolvedValue({
        rowCount: 13,
        rows: [...completeRows, { ...completeRows[0]!, id: 'extra-row', duration_seconds: 5, resolution: '1080p' }],
      }),
    } as any, {
      kind: 'video', model: 'Seedance 2.5', durationSeconds: 5, resolution: '480p',
    })).resolves.toBe(0);
  });

  it('列表接口保留可用状态并使用前端字段名', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'setting-1',
          kind: 'image',
          model: 'GPT Image 2.0',
          model_label: 'GPT Image 2.0',
          duration_seconds: null,
          resolution: null,
          credits: 28,
          reference_video_credits: null,
          available: true,
          updated_at: '2026-07-01T10:00:00.000Z',
        },
      ],
    });

    await expect(listConsumptionSettings({ query } as any)).resolves.toEqual([
      {
        id: 'setting-1',
        kind: 'image',
        model: 'GPT Image 2.0',
        modelLabel: 'GPT Image 2.0',
        durationSeconds: null,
        resolution: null,
        credits: 28,
        referenceVideoCredits: null,
        available: true,
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ]);
  });

  it('在同一事务内锁定并全量开放 Seedance 2.5 的 12 个组合，不改积分', async () => {
    const currentRows = seedance25Rows(false);
    const updatedRows = seedance25Rows(true);
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 12, rows: currentRows })
      .mockResolvedValueOnce({ rowCount: 12, rows: updatedRows });

    await expect(setVideoModelConsumptionAvailabilityWithClient({ query } as any, 'Seedance 2.5', true)).resolves.toMatchObject({
      model: 'Seedance 2.5',
      available: true,
      previousAvailableCount: 0,
      changed: true,
      settings: expect.arrayContaining([
        expect.objectContaining({ durationSeconds: 5, resolution: '480p', credits: 49, referenceVideoCredits: 30, available: true }),
        expect.objectContaining({ durationSeconds: 30, resolution: '720p', credits: 244, referenceVideoCredits: 147, available: true }),
      ]),
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE OF setting');
    expect(query.mock.calls[1]?.[0]).toContain('SET available = $2');
    expect(query.mock.calls[1]?.[1]).toEqual(['Seedance 2.5', true]);
  });

  it('组合缺失时拒绝半开放，目标状态未变化时不写库', async () => {
    const incompleteQuery = vi.fn().mockResolvedValue({ rowCount: 11, rows: seedance25Rows(false).slice(0, 11) });
    await expect(setVideoModelConsumptionAvailabilityWithClient({ query: incompleteQuery } as any, 'Seedance 2.5', true)).rejects.toMatchObject({
      code: 'SEEDANCE_25_CONSUMPTION_SETTINGS_INCOMPLETE',
      statusCode: 409,
    });
    expect(incompleteQuery).toHaveBeenCalledTimes(1);

    const extraRows = [
      ...seedance25Rows(false),
      { ...seedance25Rows(false)[0]!, id: 'extra-row', resolution: '1080p' },
    ];
    const extraQuery = vi.fn().mockResolvedValue({ rowCount: 13, rows: extraRows });
    await expect(setVideoModelConsumptionAvailabilityWithClient(
      { query: extraQuery } as any,
      'Seedance 2.5',
      true,
    )).rejects.toMatchObject({
      code: 'SEEDANCE_25_CONSUMPTION_SETTINGS_INCOMPLETE',
      statusCode: 409,
    });
    expect(extraQuery).toHaveBeenCalledTimes(1);

    const incompleteOpenRows = seedance25Rows(true).slice(0, 11);
    const closeIncompleteQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 11, rows: incompleteOpenRows })
      .mockResolvedValueOnce({
        rowCount: 11,
        rows: incompleteOpenRows.map(row => ({ ...row, available: false })),
      });
    await expect(setVideoModelConsumptionAvailabilityWithClient(
      { query: closeIncompleteQuery } as any,
      'Seedance 2.5',
      false,
    )).resolves.toMatchObject({ available: false, previousAvailableCount: 11, changed: true });

    const unchangedQuery = vi.fn().mockResolvedValue({ rowCount: 12, rows: seedance25Rows(true) });
    await expect(setVideoModelConsumptionAvailabilityWithClient({ query: unchangedQuery } as any, 'Seedance 2.5', true)).resolves.toMatchObject({
      previousAvailableCount: 12,
      changed: false,
    });
    expect(unchangedQuery).toHaveBeenCalledTimes(1);
  });

  it('任一普通或参考视频积分不是正整数时拒绝全量开放', async () => {
    const invalidCredits = seedance25Rows(false);
    invalidCredits[0] = { ...invalidCredits[0]!, credits: 0 };
    const invalidCreditsQuery = vi.fn().mockResolvedValue({ rowCount: 12, rows: invalidCredits });
    await expect(setVideoModelConsumptionAvailabilityWithClient(
      { query: invalidCreditsQuery } as any,
      'Seedance 2.5',
      true,
    )).rejects.toMatchObject({ code: 'VIDEO_MODEL_CONSUMPTION_PRICE_INVALID', statusCode: 409 });
    expect(invalidCreditsQuery).toHaveBeenCalledTimes(1);

    const invalidReferenceCredits = seedance25Rows(false);
    invalidReferenceCredits[11] = { ...invalidReferenceCredits[11]!, reference_video_credits: 0 };
    const invalidReferenceQuery = vi.fn().mockResolvedValue({ rowCount: 12, rows: invalidReferenceCredits });
    await expect(setVideoModelConsumptionAvailabilityWithClient(
      { query: invalidReferenceQuery } as any,
      'Seedance 2.5',
      true,
    )).rejects.toMatchObject({ code: 'VIDEO_MODEL_CONSUMPTION_PRICE_INVALID', statusCode: 409 });
    expect(invalidReferenceQuery).toHaveBeenCalledTimes(1);

    const fractionalCredits = seedance25Rows(false);
    fractionalCredits[4] = { ...fractionalCredits[4]!, credits: 1.5 };
    const fractionalQuery = vi.fn().mockResolvedValue({ rowCount: 12, rows: fractionalCredits });
    await expect(setVideoModelConsumptionAvailabilityWithClient(
      { query: fractionalQuery } as any,
      'Seedance 2.5',
      true,
    )).rejects.toMatchObject({ code: 'VIDEO_MODEL_CONSUMPTION_PRICE_INVALID', statusCode: 409 });
  });
});

function seedance25Rows(available: boolean) {
  const prices: Array<[number, string, number, number]> = [
    [5, '480p', 49, 30], [10, '480p', 86, 52], [15, '480p', 86, 52],
    [20, '480p', 115, 69], [25, '480p', 144, 87], [30, '480p', 172, 104],
    [5, '720p', 61, 37], [10, '720p', 107, 65], [15, '720p', 122, 74],
    [20, '720p', 163, 98], [25, '720p', 204, 123], [30, '720p', 244, 147],
  ];
  return prices.map(([duration, resolution, credits, referenceVideoCredits], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'video',
    model: 'Seedance 2.5',
    model_label: 'Seedance 2.5',
    duration_seconds: duration,
    resolution,
    credits,
    reference_video_credits: referenceVideoCredits,
    available,
    updated_at: '2026-08-12T00:00:00.000Z',
  }));
}

import { afterEach,describe,expect,it,vi } from 'vitest';
import { createAIStudioGenerateFeedbackController,type AIStudioGenerateStatus } from './AIStudioGenerateFeedback';

afterEach(() => {
  vi.useRealTimers();
});

describe('AI Studio 生成反馈状态机', () => {
  it('只有真实提交成功后进入 queued，并在 800ms 后恢复', async () => {
    vi.useFakeTimers();
    const statuses: AIStudioGenerateStatus[] = [];
    let resolveSubmission!: (queued: boolean) => void;
    const submit = vi.fn(() => new Promise<boolean>(resolve => {
      resolveSubmission = resolve;
    }));
    const controller = createAIStudioGenerateFeedbackController({
      onStatusChange: status => statuses.push(status),
    });

    const firstRun = controller.run(submit);
    const blockedRun = controller.run(submit);

    expect(controller.isLocked()).toBe(true);
    expect(statuses).toEqual(['submitting']);
    expect(await blockedRun).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);

    resolveSubmission(true);
    expect(await firstRun).toBe(true);
    expect(statuses).toEqual(['submitting', 'queued']);
    expect(controller.isLocked()).toBe(true);

    vi.advanceTimersByTime(799);
    expect(statuses[statuses.length - 1]).toBe('queued');
    expect(controller.isLocked()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(statuses[statuses.length - 1]).toBe('idle');
    expect(controller.isLocked()).toBe(false);
  });

  it('业务拒绝或异常时立即恢复 idle 并允许重试', async () => {
    const statuses: AIStudioGenerateStatus[] = [];
    const controller = createAIStudioGenerateFeedbackController({
      onStatusChange: status => statuses.push(status),
    });

    await expect(controller.run(async () => false)).resolves.toBe(false);
    expect(statuses).toEqual(['submitting', 'idle']);
    expect(controller.isLocked()).toBe(false);

    await expect(controller.run(async () => {
      throw new Error('network failed');
    })).rejects.toThrow('network failed');
    expect(statuses.slice(-2)).toEqual(['submitting', 'idle']);
    expect(controller.isLocked()).toBe(false);
  });

  it('卸载清理确认计时器，不再发送状态更新', async () => {
    vi.useFakeTimers();
    const statuses: AIStudioGenerateStatus[] = [];
    const controller = createAIStudioGenerateFeedbackController({
      onStatusChange: status => statuses.push(status),
    });

    await controller.run(async () => true);
    controller.dispose();
    vi.runAllTimers();

    expect(statuses).toEqual(['submitting', 'queued']);
    expect(controller.isLocked()).toBe(false);
  });
});

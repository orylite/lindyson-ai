interface SafeErrorEmitter {
  on(event: 'error', listener: (...args: unknown[]) => void): unknown;
}

export function registerSafeEmitterErrorListener(
  emitter: SafeErrorEmitter,
  event: string,
  errorCode: string,
  log: (line: string) => void = line => console.error(line),
) {
  emitter.on('error', () => {
    try {
      log(JSON.stringify({ event, errorCode }));
    } catch {
      // 诊断日志不能把基础设施 error 事件重新升级为未捕获异常。
    }
  });
}

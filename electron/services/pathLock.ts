/**
 * PATH 写入互斥锁
 * 防止多个 Manager 并发修改用户 PATH 导致覆盖
 */
let _chain: Promise<void> = Promise.resolve();

export function withPathLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolvePrev!: () => void;
  const prev = new Promise<void>((r) => (resolvePrev = r));
  const prevWait = _chain;
  _chain = _chain.then(() => prev);

  return prevWait.then(async () => {
    try {
      return await fn();
    } finally {
      resolvePrev();
    }
  });
}

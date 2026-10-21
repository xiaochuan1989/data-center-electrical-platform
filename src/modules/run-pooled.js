// 有限并行：最多 limit 个任务同时进行；任一失败后不再领取新任务，等在途任务结束后抛出第一个错误。
export async function runPooled(items, limit, fn) {
  const results = new Array(items.length); let next = 0, failed = null;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !failed) { const i = next++; try { results[i] = await fn(items[i], i); } catch (error) { failed ||= error; } }
  }));
  if (failed) throw failed;
  return results;
}

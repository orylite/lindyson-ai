import { env } from '../config/env.js';
import { pool, withTransaction } from './pool.js';

async function run() {
  if (env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止写入开发 Mock 数据。');
  }

  await withTransaction(async client => {
    const announcements = [
      ['本地开发环境已就绪', '这是一条仅供本地开发和自动化测试使用的示例公告。', true],
      ['生成队列测试提示', '开发环境可显式开启 Fake Provider 验证视频任务恢复与结算流程。', false],
    ];

    for (const announcement of announcements) {
      await client.query(
        `INSERT INTO announcements (title, content, pinned)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM announcements WHERE title = $1 AND content = $2
         )`,
        announcement,
      );
    }
  });

  console.log('开发 Mock 数据已写入。');
}

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

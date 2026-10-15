import { describe,expect,it,vi } from 'vitest';
import { fileURLToPath } from 'node:url';

// CLI 使用 Node 原生 ESM；这里直接验证其纯函数和无网络提交分支。
// @ts-expect-error 项目不编译 scripts 目录中的 mjs 类型声明。
import { parseSitemapUrls,submitBaiduUrls,validateBaiduResponse,validateSubmissionUrls } from '../../../scripts/submit-baidu-urls.mjs';

const sitemapPath = fileURLToPath(new URL('../../../public/sitemap.xml',import.meta.url));

describe('百度普通收录提交脚本', () => {
  it('解析 sitemap、去重并拒绝非本站 URL', () => {
    expect(parseSitemapUrls('<urlset><loc>https://www.lindyson.com/</loc><loc>https://www.lindyson.com/</loc></urlset>')).toEqual([
      'https://www.lindyson.com/',
    ]);
    expect(() => validateSubmissionUrls('https://www.lindyson.com', ['https://lindyson.com/'])).toThrow(/非本站/);
  });

  it('dry-run 不需要密钥且不会发起网络请求', async () => {
    const fetchImpl = vi.fn();
    const messages: string[] = [];
    const result = await submitBaiduUrls({
      env: { BAIDU_SITE_URL: 'https://www.lindyson.com',BAIDU_SITEMAP_PATH: sitemapPath },
      args: ['--dry-run'],
      fetchImpl,
      write: (message: string) => messages.push(message),
    });

    expect(result.dryRun).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(messages.join('\n')).toContain('https://www.lindyson.com/');
  });

  it('真实提交缺少密钥时明确失败', async () => {
    await expect(submitBaiduUrls({
      env: { BAIDU_SITE_URL: 'https://www.lindyson.com',BAIDU_SITEMAP_PATH: sitemapPath },
      args: [],
      fetchImpl: vi.fn(),
      write: vi.fn(),
    })).rejects.toThrow(/BAIDU_PUSH_TOKEN/);
  });

  it('校验百度反馈字段并拒绝非法响应', () => {
    expect(validateBaiduResponse({ success: 1,remain: 99,not_same_site: [],not_valid: [] })).toEqual({
      success: 1,remain: 99,notSameSite: [],notValid: [],
    });
    expect(() => validateBaiduResponse({ success: 1 })).toThrow(/success 或 remain/);
  });
});

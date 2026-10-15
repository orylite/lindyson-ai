import { afterEach,describe,expect,it,vi } from 'vitest';
import { requestAdminAssetDownload } from '../api/mutations';
import { downloadAdminAsset,prepareAdminAssetDownload,prepareAssetDownload,startBrowserDownload } from './assetDownload';

vi.mock('../api/mutations', () => ({
  requestAssetDownload: vi.fn(),
  requestAdminAssetDownload: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('素材下载', () => {
  it('缺少资产 ID 时不会请求或回退到缩略图、公开地址', async () => {
    await expect(prepareAssetDownload({
      name: '图片素材',
      type: 'image',
    })).resolves.toBeNull();
  });

  it('管理员下载缺少资产 ID 时也不会请求或回退到预览地址', async () => {
    await expect(prepareAdminAssetDownload({
      name: '用户成片',
      type: 'video',
    })).resolves.toBeNull();
    expect(requestAdminAssetDownload).not.toHaveBeenCalled();
  });

  it('管理员下载使用管理员短期凭证并触发浏览器附件下载', async () => {
    vi.mocked(requestAdminAssetDownload).mockResolvedValue({
      url: 'https://storage.example.com/admin-video.mp4?signature=test',
      filename: '用户成片.mp4',
    });
    const link = {
      href: '',
      download: '',
      rel: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => link),
      body: { appendChild: vi.fn() },
    });

    await expect(downloadAdminAsset({
      id: 'asset-1',
      name: '用户成片',
      type: 'video',
    })).resolves.toEqual({
      url: 'https://storage.example.com/admin-video.mp4?signature=test',
      filename: '用户成片.mp4',
    });
    expect(requestAdminAssetDownload).toHaveBeenCalledWith('asset-1');
    expect(link).toMatchObject({
      href: 'https://storage.example.com/admin-video.mp4?signature=test',
      download: '用户成片.mp4',
      rel: 'noopener noreferrer',
    });
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
  });

  it('使用临时链接下载且不打开新页面', () => {
    const link = {
      href: '',
      download: '',
      rel: '',
      target: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => link),
      body: { appendChild },
    });

    startBrowserDownload('https://storage.example.com/video.mp4', '成片.mp4');

    expect(link).toMatchObject({
      href: 'https://storage.example.com/video.mp4',
      download: '成片.mp4',
      rel: 'noopener noreferrer',
      target: '',
    });
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
  });
});

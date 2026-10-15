import { Pencil,Pin,Plus,Trash2 } from 'lucide-react';
import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import { type PlatformAnnouncement } from '../../data/admin';
import { Badge,Button,Toggle } from '../../ui';
import {
  AdminDataTable,
  AdminInput,
  AdminTextarea,
  PageShell,
  SearchFilter,
  Stack,
} from '../components/AdminPageShared';
import type { AdminListControls,ConfirmState,DetailState } from '../types';

const MAX_PINNED_ANNOUNCEMENTS = 3;

interface AdminAnnouncementsPageProps {
  announcements: PlatformAnnouncement[];
  control: AdminListControls['announcements'];
  onCreate: (payload: { title: string; content: string; pinned: boolean }) => Promise<void>;
  onUpdate: (id: string, payload: Partial<{ title: string; content: string; pinned: boolean }>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  setDetail: (detail: DetailState | null) => void;
  setConfirm: (confirm: ConfirmState) => void;
}

interface AnnouncementFormProps {
  announcement?: PlatformAnnouncement;
  onCreate: AdminAnnouncementsPageProps['onCreate'];
  onUpdate: AdminAnnouncementsPageProps['onUpdate'];
  canSetPinned: (excludeId?: string) => boolean;
  setConfirm: (confirm: ConfirmState) => void;
  onClose: () => void;
}

function AnnouncementDetail({ announcement }: { announcement: PlatformAnnouncement }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={announcement.pinned ? 'pink' : 'default'}>{announcement.pinned ? '置顶公告' : '普通公告'}</Badge>
          <span className="text-xs text-gray-500">{announcement.publishedAt}</span>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white">{announcement.content}</p>
      </div>
    </div>
  );
}

function AnnouncementForm({ announcement, onCreate, onUpdate, canSetPinned, setConfirm, onClose }: AnnouncementFormProps) {
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [content, setContent] = useState(announcement?.content ?? '');
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [submitting, setSubmitting] = useState(false);
  const editingId = announcement?.id;

  const handlePinnedChange = (nextPinned: boolean) => {
    if (nextPinned && !canSetPinned(editingId)) {
      toast.error(`最多可置顶 ${MAX_PINNED_ANNOUNCEMENTS} 条公告`);
      return;
    }
    setPinned(nextPinned);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const nextTitle = title.trim();
    const nextContent = content.trim();

    if (!nextTitle || !nextContent) {
      toast.error('请填写公告标题和内容');
      return;
    }

    if (pinned && !canSetPinned(editingId)) {
      toast.error(`最多可置顶 ${MAX_PINNED_ANNOUNCEMENTS} 条公告`);
      return;
    }

    if (editingId) {
      try {
        setSubmitting(true);
        await onUpdate(editingId, { title: nextTitle, content: nextContent, pinned });
        onClose();
        toast.success('公告已修改');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '公告保存失败');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setConfirm({
      title: '发布公告',
      description: pinned
        ? `确认发布「${nextTitle}」吗？该公告将置顶展示。`
        : `确认发布「${nextTitle}」吗？`,
      confirmLabel: '确认发布',
      onConfirm: async () => {
        try {
          await onCreate({ title: nextTitle, content: nextContent, pinned });
          onClose();
          toast.success(pinned ? '置顶公告已发布' : '公告已发布');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '公告发布失败');
        }
      },
    });
  };

  return (
    <div className="space-y-5">
      <AdminInput label="公告标题" value={title} onChange={setTitle} />
      <AdminTextarea label="公告内容" value={content} onChange={setContent} rows={6} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex min-h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3">
          <span className="text-sm text-gray-300">置顶公告</span>
          <Toggle enabled={pinned} disabled={submitting} ariaLabel="置顶公告" onChange={handlePinnedChange} size="sm" />
        </div>
        <Button
          type="button"
          variant="pink"
          loading={submitting}
          icon={editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          onClick={() => void handleSubmit()}
        >
          {editingId ? '保存修改' : '发布公告'}
        </Button>
      </div>
    </div>
  );
}

export function AdminAnnouncementsPage({ announcements, control, onCreate, onUpdate, onDelete, setDetail, setConfirm }: AdminAnnouncementsPageProps) {
  const [search, setSearch] = useState(control.filters.search ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({ search: search.trim() || undefined }), 300);
    return () => window.clearTimeout(timer);
  }, [control.setFilters, search]);

  const openDetail = (announcement: PlatformAnnouncement) => {
    setDetail({
      title: announcement.title,
      subtitle: announcement.publishedAt,
      content: <AnnouncementDetail announcement={announcement} />,
    });
  };

  const canSetPinned = (excludeId?: string) => {
    return announcements.filter(item => item.pinned && item.id !== excludeId).length < MAX_PINNED_ANNOUNCEMENTS;
  };

  const openCreate = () => {
    setDetail({
      title: '新增公告',
      subtitle: '填写公告标题、内容和置顶状态',
      content: (
        <AnnouncementForm
          onCreate={onCreate}
          onUpdate={onUpdate}
          canSetPinned={canSetPinned}
          setConfirm={setConfirm}
          onClose={() => setDetail(null)}
        />
      ),
    });
  };

  const togglePinned = (announcement: PlatformAnnouncement) => {
    if (!announcement.pinned && !canSetPinned(announcement.id)) {
      toast.error(`最多可置顶 ${MAX_PINNED_ANNOUNCEMENTS} 条公告`);
      return;
    }

    void onUpdate(announcement.id, { pinned: !announcement.pinned })
      .then(() => toast.success(announcement.pinned ? '已取消置顶' : '公告已置顶'))
      .catch(error => toast.error(error instanceof Error ? error.message : '公告置顶状态保存失败'));
  };

  const openEdit = (announcement: PlatformAnnouncement) => {
    setDetail({
      title: '修改公告',
      subtitle: announcement.publishedAt,
      content: (
        <AnnouncementForm
          announcement={announcement}
          onCreate={onCreate}
          onUpdate={onUpdate}
          canSetPinned={canSetPinned}
          setConfirm={setConfirm}
          onClose={() => setDetail(null)}
        />
      ),
    });
  };

  const handleDelete = (announcement: PlatformAnnouncement) => {
    setConfirm({
      title: '删除公告',
      description: `确认删除「${announcement.title}」吗？删除后用户端不再展示。`,
      confirmLabel: '删除公告',
      danger: true,
      onConfirm: async () => {
        try {
          await onDelete(announcement.id);
          toast.success('公告已删除');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '公告删除失败');
        }
      },
    });
  };

  return (
    <PageShell
      title="平台公告"
      subtitle="发布用户端仪表盘公告，最多可设置 3 条置顶公告"
      action={<Button size="md" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>新增公告</Button>}
    >
      <div className="space-y-3">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索公告标题或内容..." />
        <AdminDataTable
          items={announcements}
          paginationLabel="平台公告分页导航"
          gridTemplate="minmax(0, 1.4fr) 150px 100px 360px"
          serverPagination={control.pagination}
          serverLoading={control.loading}
          onServerNavigate={control.navigate}
          onRowClick={openDetail}
          columns={[
            {
              header: '公告',
              render: item => (
                <Stack
                  title={(
                    <span className="flex min-w-0 items-center gap-2">
                      {item.pinned && <Pin className="h-3.5 w-3.5 flex-shrink-0 text-pink-300" />}
                      <span className="truncate">{item.title}</span>
                    </span>
                  )}
                  subtitle={<span className="line-clamp-1">{item.content}</span>}
                />
              ),
            },
            {
              header: '发布时间',
              render: item => <span className="text-gray-300">{item.publishedAt}</span>,
            },
            {
              header: '置顶',
              render: item => <Badge variant={item.pinned ? 'pink' : 'default'}>{item.pinned ? '置顶' : '普通'}</Badge>,
            },
            {
              header: '操作',
              className: 'justify-end',
              render: item => (
                <div className="flex flex-nowrap items-center justify-end gap-2" onClick={event => event.stopPropagation()}>
                  <Button type="button" size="sm" variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => openDetail(item)}>
                    详情
                  </Button>
                  <Button type="button" size="sm" variant="secondary" className="flex-shrink-0 whitespace-nowrap" onClick={() => openEdit(item)}>
                    修改
                  </Button>
                  <Button type="button" size="sm" variant={item.pinned ? 'ghost' : 'pink'} className="flex-shrink-0 whitespace-nowrap" onClick={() => togglePinned(item)}>
                    {item.pinned ? '取消置顶' : '置顶'}
                  </Button>
                  <Button type="button" size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} className="flex-shrink-0 whitespace-nowrap" onClick={() => handleDelete(item)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
    </PageShell>
  );
}

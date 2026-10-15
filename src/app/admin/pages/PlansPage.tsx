import {
  Plus
} from 'lucide-react';
import { useMemo,useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminPlan
} from '../../data/admin';
import { Badge,Button } from '../../ui';

import {
  AdminDataTable,
  PageShell,
  PlanDetail,
  PlanEditForm,
  PlanIconPreview,
  SearchFilter,
  SelectFilter,
  Stack,
  number,
  planCreditLabel,
  planPriceLabel,
  planTypeBadge,
  recommendationLabel,
  statusBadge
} from '../components/AdminPageShared';
import type { ConfirmState,DetailState } from '../types';

export function AdminPlansPage({ plans, onPlanSave, setDetail, setConfirm }: {
  plans: AdminPlan[];
  onPlanSave: (plan: AdminPlan) => Promise<void>;
  setDetail: React.Dispatch<React.SetStateAction<DetailState | null>>;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled' | 'draft'>('all');

  const filtered = useMemo(() => plans
    .filter(plan => {
      const matchSearch = `${plan.name} ${plan.code}`.toLowerCase().includes(search.toLowerCase());
      const matchStatus = status === 'all' || plan.status === status;
      return matchSearch && matchStatus;
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'main' ? -1 : 1;
      return left.monthlyPrice - right.monthlyPrice;
    }), [plans, search, status]);

  const togglePlan = (plan: AdminPlan) => {
    setConfirm({
      title: plan.status === 'active' ? '确认下架套餐？' : '确认启用套餐？',
      description: `${plan.name} 的可购买状态将被更新。`,
      confirmLabel: plan.status === 'active' ? '下架套餐' : '启用套餐',
      danger: plan.status === 'active',
      onConfirm: async () => {
        try {
          await onPlanSave({ ...plan, status: plan.status === 'active' ? 'disabled' : 'active' });
          toast.success('套餐状态已更新');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '套餐状态更新失败');
        }
      },
    });
  };

  const savePlan = async (plan: AdminPlan, message: string) => {
    try {
      await onPlanSave(plan);
      setDetail(null);
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '套餐保存失败');
    }
  };

  return (
    <PageShell
      title="订阅套餐管理"
      subtitle="管理套餐价格、周期、积分、真人演员库结构化额度、功能限制与上下架状态"
      action={
        <Button
          size="md"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setDetail({
            title: '新增套餐',
            subtitle: '选择主套餐或一次性加购包',
            wide: true,
            content: (
              <PlanEditForm
                onSave={(plan) => savePlan(plan, '套餐已新增')}
              />
            ),
          })}
        >
          新增套餐
        </Button>
      }
    >
      <SearchFilter search={search} onSearch={setSearch} placeholder="搜索套餐名称或代码...">
        <SelectFilter value={status} onChange={setStatus} label="状态" options={[
          { value: 'all', label: '全部状态' },
          { value: 'active', label: '启用中' },
          { value: 'disabled', label: '已停用' },
          { value: 'draft', label: '草稿' },
        ]} />
      </SearchFilter>
      <AdminDataTable
        items={filtered}
        paginate={false}
        gridTemplate="1.1fr .6fr 1fr .75fr .8fr .65fr .65fr 120px"
        columns={[
          { header: '套餐', render: plan => (
            <div className="flex min-w-0 items-center gap-3">
              <PlanIconPreview plan={plan} />
              <Stack title={plan.name} subtitle={`${plan.code} · ${plan.nameEn}`} />
            </div>
          ) },
          { header: '类型', render: plan => planTypeBadge(plan.kind) },
          { header: '价格/一次性价格', render: plan => <span>{planPriceLabel(plan)}</span> },
          { header: '积分', render: plan => planCreditLabel(plan) },
          { header: '订阅用户', render: plan => (
            <div className="flex items-center gap-2">
              <span>{number(plan.subscribers)}</span>
              {plan.recommendation && <Badge variant={plan.recommendation === 'popular' ? 'pink' : 'orange'}>{recommendationLabel(plan.recommendation)}</Badge>}
            </div>
          ) },
          { header: '首页', render: plan => (
            <Badge variant={plan.landingVisible ? 'success' : 'default'}>
              {plan.landingVisible ? '展示' : '隐藏'}
            </Badge>
          ) },
          { header: '状态', render: plan => statusBadge(plan.status) },
          { header: '操作', className: 'justify-end', render: plan => (
            <div className="flex gap-2" onClick={event => event.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => setDetail({
                title: '编辑套餐',
                subtitle: plan.name,
                wide: true,
                content: (
                  <PlanEditForm
                    plan={plan}
                    onSave={(nextPlan) => savePlan(nextPlan, '套餐信息已保存')}
                  />
                ),
              })}>编辑</Button>
              <Button size="sm" variant={plan.status === 'active' ? 'danger' : 'primary'} onClick={() => togglePlan(plan)}>{plan.status === 'active' ? '下架' : '启用'}</Button>
            </div>
          ) },
        ]}
        onRowClick={plan => setDetail({ title: plan.name, subtitle: '套餐详情', content: <PlanDetail plan={plan} /> })}
      />
    </PageShell>
  );
}

import { CheckCircle2,Clock,LifeBuoy,Mail,MessageSquare,ReceiptText,SendHorizontal,X } from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import { type AccountProfile } from '../data/account';
import { type AdminOrder,type Priority,type TicketMessage,type UserTicket } from '../data/admin';
import { getTicketUnreadTotal,isValidEmail,sortTicketsByRecentActivity } from '../state/support';
import { Button,Card,Dialog,Input,Textarea } from '../ui';
import { formatCnyFromCents } from '../utils/currency';
import { CursorPagination } from './CursorPagination';
import { PaginationFooter } from './PaginationFooter';

// 客服二维码图片地址由部署方通过 VITE_SUPPORT_QR_URL 提供（例如 /support-qr.png）；未配置时不显示扫码区域。
const SUPPORT_QR_URL = (import.meta.env.VITE_SUPPORT_QR_URL ?? '').trim();

interface ContactSupportModalProps {
  open: boolean;
  onClose: () => void;
  account: AccountProfile;
  tickets: UserTicket[];
  ticketPagination?: CursorPaginationState;
  ticketPageLoading?: boolean;
  ticketPageError?: string;
  onTicketPageRetry: () => void;
  orders: AdminOrder[];
  orderPagination?: CursorPaginationState;
  orderPageLoading?: boolean;
  onSupportTicketCreate: (ticket: { title: string; message: string; priority: Priority }) => Promise<UserTicket>;
  onTicketMessagesLoad: (ticketId: string) => Promise<TicketMessage[]>;
  onTicketReply: (ticketId: string, message: string) => Promise<TicketMessage>;
  onTicketRead: (ticketId: string) => Promise<void>;
  onTicketPageNavigate: (position: PagePosition) => void;
  onOrderPageNavigate: (position: PagePosition) => void;
  onInvoiceRequestCreate: (request: { orderId: string; invoiceTitle: string; taxId: string; receiveEmail: string; note: string }) => Promise<void>;
}

type ContactMode = 'tickets' | 'issue' | 'invoice';

const issueTypes = ['生成问题', '账号与订阅', 'TikTok 授权', '其他问题'];
const priorityOptions: Array<{ value: Priority; label: string; slaHours: number }> = [
  { value: 'medium', label: '普通', slaHours: 6 },
  { value: 'high', label: '紧急', slaHours: 2 },
  { value: 'low', label: '低优先级', slaHours: 12 },
];

export function ContactSupportModal({
  open,
  onClose,
  account,
  tickets,
  ticketPagination,
  ticketPageLoading,
  ticketPageError,
  onTicketPageRetry,
  orders,
  orderPagination,
  orderPageLoading,
  onSupportTicketCreate,
  onTicketMessagesLoad,
  onTicketReply,
  onTicketRead,
  onTicketPageNavigate,
  onOrderPageNavigate,
  onInvoiceRequestCreate,
}: ContactSupportModalProps) {
  const [contactMode, setContactMode] = useState<ContactMode>('tickets');
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [createdTicket, setCreatedTicket] = useState<UserTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueType, setIssueType] = useState(issueTypes[0]);
  const [issuePriority, setIssuePriority] = useState<Priority>('medium');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [invoiceTitle, setInvoiceTitle] = useState('');
  const [taxId, setTaxId] = useState('');
  const [receiveEmail, setReceiveEmail] = useState(account.email);
  const [invoiceNote, setInvoiceNote] = useState('');
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const openCycleRef = useRef(false);
  const dialogBusy = issueSubmitting || invoiceSubmitting || replying;

  const sortedTickets = useMemo(() => sortTicketsByRecentActivity(tickets), [tickets]);
  const selectedTicket = sortedTickets.find(ticket => ticket.id === selectedTicketId)
    ?? (createdTicket?.id === selectedTicketId ? createdTicket : sortedTickets[0]);
  const unreadTotal = getTicketUnreadTotal(tickets);
  const invoiceableOrders = orders;
  const contactEmail = account.email;

  useEffect(() => {
    if (!open) {
      openCycleRef.current = false;
      setCreatedTicket(null);
      return;
    }
    if (openCycleRef.current) return;
    openCycleRef.current = true;

    setReceiveEmail(account.email);
    setSelectedOrderId(invoiceableOrders[0]?.id ?? '');

    const firstTicket = sortedTickets.find(ticket => ticket.unreadCount > 0) ?? sortedTickets[0];
    setContactMode('tickets');
    setSelectedTicketId(firstTicket?.id ?? '');
  }, [account.email, invoiceableOrders, open]);

  useEffect(() => {
    if (!open || invoiceableOrders.some(order => order.id === selectedOrderId)) return;
    setSelectedOrderId(invoiceableOrders[0]?.id ?? '');
  }, [invoiceableOrders, open, selectedOrderId]);

  useEffect(() => {
    if (!open || contactMode !== 'tickets') return;
    if (createdTicket?.id === selectedTicketId) {
      if (sortedTickets.some(ticket => ticket.id === selectedTicketId)) setCreatedTicket(null);
      return;
    }
    if (selectedTicketId && sortedTickets.some(ticket => ticket.id === selectedTicketId)) return;
    const nextTicketId = sortedTickets[0]?.id ?? '';
    setMessages([]);
    setMessagesLoading(Boolean(nextTicketId));
    setSelectedTicketId(nextTicketId);
  }, [contactMode, createdTicket, open, selectedTicketId, sortedTickets]);

  useEffect(() => {
    if (!open || contactMode !== 'tickets' || !selectedTicketId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    let canceled = false;
    setMessages([]);
    setMessagesLoading(true);
    onTicketMessagesLoad(selectedTicketId)
      .then(nextMessages => {
        if (!canceled) setMessages(nextMessages);
      })
      .catch(error => {
        if (!canceled && !isAbortError(error)) toast.error('工单消息加载失败，请稍后重试');
      })
      .finally(() => {
        if (!canceled) setMessagesLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [contactMode, onTicketMessagesLoad, open, selectedTicketId]);

  useEffect(() => {
    if (!open || contactMode !== 'tickets' || !selectedTicket || selectedTicket.unreadCount <= 0) return;

    let canceled = false;
    void onTicketRead(selectedTicket.id).catch(error => {
      if (!canceled && !isAbortError(error)) {
        toast.warning('工单已读状态更新失败，稍后重新打开将自动重试');
      }
    });

    return () => {
      canceled = true;
    };
  }, [contactMode, onTicketRead, open, selectedTicket?.id, selectedTicket?.unreadCount]);

  const submitIssue = async () => {
    if (issueSubmitting) return;
    const email = contactEmail.trim();
    const title = issueTitle.trim();
    const description = issueDescription.trim();

    if (!isValidEmail(email)) {
      toast.error('请填写有效的联系邮箱');
      return;
    }
    if (!title) {
      toast.error('请填写问题标题');
      return;
    }
    if (!description) {
      toast.error('请填写问题描述');
      return;
    }

    try {
      setIssueSubmitting(true);
      const created = await onSupportTicketCreate({
        title,
        priority: issuePriority,
        message: `问题类型：${issueType}\n${description}`,
      });
      toast.success('问题已提交，可在当前窗口继续沟通');
      setIssueTitle('');
      setIssueDescription('');
      setMessages([]);
      setMessagesLoading(true);
      setContactMode('tickets');
      setCreatedTicket(created);
      setSelectedTicketId(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '问题提交失败');
    } finally {
      setIssueSubmitting(false);
    }
  };

  const submitReply = async () => {
    const body = replyText.trim();
    if (!selectedTicket) return;
    if (selectedTicket.status === 'resolved') {
      toast.error('工单已关闭，不能继续回复');
      return;
    }
    if (!body) {
      toast.error('请填写回复内容');
      return;
    }

    try {
      setReplying(true);
      const message = await onTicketReply(selectedTicket.id, body);
      setMessages(prev => [...prev, message]);
      setReplyText('');
      toast.success('回复已发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回复发送失败');
    } finally {
      setReplying(false);
    }
  };

  const selectTicket = (ticket: UserTicket) => {
    if (ticket.id !== selectedTicketId) {
      setMessages([]);
      setMessagesLoading(true);
    }
    setCreatedTicket(null);
    setSelectedTicketId(ticket.id);
    setContactMode('tickets');
  };

  const submitInvoiceRequest = async () => {
    if (invoiceSubmitting) return;
    const email = contactEmail.trim();
    const invoiceEmail = receiveEmail.trim();
    const order = invoiceableOrders.find(item => item.id === selectedOrderId);

    if (!isValidEmail(email)) {
      toast.error('请填写有效的联系邮箱');
      return;
    }
    if (!isValidEmail(invoiceEmail)) {
      toast.error('请填写有效的接收邮箱');
      return;
    }
    if (!order) {
      toast.error('请选择已支付订单');
      return;
    }
    if (order.invoiceStatus === 'issued') {
      toast.error('该订单已开票，不能重复申请');
      return;
    }
    if (order.invoiceRequestStatus && order.invoiceRequestStatus !== 'none') {
      toast.error('该订单已有发票申请，请等待处理');
      return;
    }
    if (!invoiceTitle.trim()) {
      toast.error('请填写发票抬头');
      return;
    }
    if (!taxId.trim()) {
      toast.error('请填写税号');
      return;
    }

    try {
      setInvoiceSubmitting(true);
      await onInvoiceRequestCreate({
        orderId: order.id,
        invoiceTitle: invoiceTitle.trim(),
        taxId: taxId.trim(),
        receiveEmail: invoiceEmail,
        note: invoiceNote.trim() || '无补充说明',
      });
      toast.success('发票申请已提交');
      setInvoiceTitle('');
      setTaxId('');
      setInvoiceNote('');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发票申请提交失败');
    } finally {
      setInvoiceSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <Dialog
          open={open}
          onClose={onClose}
          titleId="support-modal-title"
          closeDisabled={dialogBusy}
          closeOnBackdrop={false}
          position="absolute"
          zIndexClass="z-[70]"
          panelClassName="flex h-[calc(100vh-1.5rem)] max-w-6xl sm:h-[calc(100vh-3rem)]"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            data-testid="support-modal-card"
            className="flex h-full w-full"
          >
            <Card variant="modal" className="flex h-full w-full flex-col overflow-hidden">
              <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <h2 id="support-modal-title" className="font-semibold text-white">联系客服</h2>
                  <p className="mt-1 text-xs text-gray-500">{SUPPORT_QR_URL ? '查看工单对话、提交问题或申请发票，也可以扫码添加飞书联系人。' : '查看工单对话、提交问题或申请发票。'}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={dialogBusy}
                  className="rounded-lg bg-white/5 p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-wait disabled:opacity-50"
                  aria-label="关闭客服窗口"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-h-0 flex-col gap-5 p-5 md:border-r md:border-white/10">
                  <div role="tablist" aria-label="客服功能" className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
                    {[
                      { id: 'tickets' as ContactMode, label: '我的工单', icon: LifeBuoy, count: unreadTotal },
                      { id: 'issue' as ContactMode, label: '提交问题', icon: MessageSquare },
                      { id: 'invoice' as ContactMode, label: '申请发票', icon: ReceiptText },
                    ].map((item, index, items) => {
                      const Icon = item.icon;
                      const active = contactMode === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          tabIndex={active ? 0 : -1}
                          disabled={dialogBusy}
                          onClick={() => setContactMode(item.id)}
                          onKeyDown={event => {
                            const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                            if (!offset) return;
                            event.preventDefault();
                            const nextIndex = (index + offset + items.length) % items.length;
                            const nextItem = items[nextIndex];
                            if (!nextItem) return;
                            setContactMode(nextItem.id);
                            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
                          }}
                          className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition-all ${
                            active
                              ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg shadow-purple-500/20'
                              : 'text-gray-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {item.count ? (
                            <span className="rounded-full bg-white/20 px-1.5 text-[11px] leading-5 text-white">{item.count > 99 ? '99+' : item.count}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <Input
                    label="联系邮箱"
                    value={contactEmail}
                    readOnly
                    icon={<Mail className="w-4 h-4" />}
                    hint="以当前登录账号邮箱为准"
                    className="cursor-default bg-white/[0.03] text-gray-300"
                  />

                  {contactMode === 'tickets' && ticketPageError && (
                    <div role="alert" className="flex items-center justify-between gap-3 text-sm text-gray-300">
                      <span>{ticketPageError}</span>
                      <Button type="button" disabled={ticketPageLoading} onClick={onTicketPageRetry}>重试加载</Button>
                    </div>
                  )}

                  <div className="min-h-0 flex-1 overflow-hidden">
                    {contactMode === 'tickets' ? (
                      <TicketThreadPanel
                        tickets={sortedTickets}
                        selectedTicket={selectedTicket}
                        messages={messages}
                        messagesLoading={messagesLoading}
                        replyText={replyText}
                        replying={replying}
                        pagination={ticketPagination}
                        pageLoading={ticketPageLoading}
                        pageError={ticketPageError}
                        onPageNavigate={onTicketPageNavigate}
                        onSelectTicket={selectTicket}
                        onReplyTextChange={setReplyText}
                        onReplySubmit={submitReply}
                        onCreateNew={() => setContactMode('issue')}
                      />
                    ) : contactMode === 'issue' ? (
                      <div className="h-full overflow-y-auto pr-1">
                        <IssueForm
                          issueTitle={issueTitle}
                          issueType={issueType}
                          issuePriority={issuePriority}
                          issueDescription={issueDescription}
                          onTitleChange={setIssueTitle}
                          onTypeChange={setIssueType}
                          onPriorityChange={setIssuePriority}
                          onDescriptionChange={setIssueDescription}
                          onSubmit={submitIssue}
                          submitting={issueSubmitting}
                        />
                      </div>
                    ) : (
                      <div className="h-full overflow-y-auto pr-1">
                        <InvoiceForm
                          invoiceableOrders={invoiceableOrders}
                          pagination={orderPagination}
                          pageLoading={orderPageLoading}
                          selectedOrderId={selectedOrderId}
                          invoiceTitle={invoiceTitle}
                          taxId={taxId}
                          receiveEmail={receiveEmail}
                          invoiceNote={invoiceNote}
                          onOrderChange={setSelectedOrderId}
                          onPageNavigate={onOrderPageNavigate}
                          onInvoiceTitleChange={setInvoiceTitle}
                          onTaxIdChange={setTaxId}
                          onReceiveEmailChange={setReceiveEmail}
                          onInvoiceNoteChange={setInvoiceNote}
                          onSubmit={submitInvoiceRequest}
                          submitting={invoiceSubmitting}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {SUPPORT_QR_URL ? (
                  <div className="hidden items-center justify-center p-6 md:flex">
                    <div className="w-full max-w-[260px] text-center">
                      <p className="mb-3 text-sm font-semibold text-white">Lindyson AI 客服</p>
                      <div className="rounded-[22px] bg-white p-[5px] shadow-2xl shadow-black/30">
                        <img src={SUPPORT_QR_URL} alt="飞书联系二维码" className="w-full rounded-[16px]" />
                      </div>
                      <p className="mt-3 text-sm font-medium text-gray-300">飞书扫码联系客服</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          </motion.div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function TicketThreadPanel({
  tickets,
  selectedTicket,
  messages,
  messagesLoading,
  replyText,
  replying,
  pagination,
  pageLoading,
  pageError,
  onPageNavigate,
  onSelectTicket,
  onReplyTextChange,
  onReplySubmit,
  onCreateNew,
}: {
  tickets: UserTicket[];
  selectedTicket?: UserTicket;
  messages: TicketMessage[];
  messagesLoading: boolean;
  replyText: string;
  replying: boolean;
  pagination?: CursorPaginationState;
  pageLoading?: boolean;
  pageError?: string;
  onPageNavigate: (position: PagePosition) => void;
  onSelectTicket: (ticket: UserTicket) => void;
  onReplyTextChange: (value: string) => void;
  onReplySubmit: () => void;
  onCreateNew: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messagesLoading) return;
    const messageList = messagesRef.current;
    if (!messageList) return;
    messageList.scrollTo({ top: messageList.scrollHeight });
  }, [messagesLoading, messages.length, selectedTicket?.id]);

  if (tickets.length === 0 && !selectedTicket && (pageLoading || pageError)) {
    return pageLoading ? <p role="status" className="text-sm text-gray-400">正在加载工单…</p> : null;
  }

  if (tickets.length === 0 && !selectedTicket) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <LifeBuoy className="mx-auto h-8 w-8 text-purple-300" />
        <p className="mt-3 text-sm font-semibold text-white">暂无工单</p>
        <p className="mt-1 text-xs text-gray-500">提交问题后，可在这里继续和客服沟通。</p>
        <Button type="button" variant="pink" className="mt-5" onClick={onCreateNew}>提交问题</Button>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(120px,160px)_minmax(0,1fr)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
      <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
        {tickets.length === 0 && pageLoading && <p role="status" className="text-sm text-gray-400">正在加载工单…</p>}
        {tickets.map(ticket => {
          const active = selectedTicket?.id === ticket.id;
          return (
            <button
              key={ticket.id}
              type="button"
              onClick={() => onSelectTicket(ticket)}
              className={`w-full rounded-xl border p-3 text-left transition-all ${
                active
                  ? 'border-purple-500/60 bg-purple-500/15'
                  : 'border-white/10 bg-white/5 hover:border-purple-500/40 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{ticket.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{ticket.lastMessage}</p>
                </div>
                {ticket.unreadCount > 0 && (
                  <span className="min-w-5 rounded-full bg-pink-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                    {ticket.unreadCount > 99 ? '99+' : ticket.unreadCount}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                <span>{ticket.status === 'resolved' ? '已关闭' : ticket.status === 'pending' ? '客服已回复' : '待响应'}</span>
                <span>{ticket.lastMessageAt}</span>
              </div>
            </button>
          );
        })}
        {pagination && (
          <PaginationFooter count={tickets.length} totalItems={pagination.totalItems} totalPages={pagination.totalPages} hideSummary stacked className="sticky bottom-0 bg-[var(--product-surface-floating)] py-2">
            <CursorPagination
              pagination={pagination}
              loading={pageLoading || Boolean(pageError)}
              empty={tickets.length === 0}
              onNavigate={onPageNavigate}
              label="我的工单翻页"
            />
          </PaginationFooter>
        )}
      </div>

      <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
        {selectedTicket ? (
          <>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{selectedTicket.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{selectedTicket.id}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                  selectedTicket.status === 'resolved'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-purple-500/15 text-purple-300'
                }`}>
                  {selectedTicket.status === 'resolved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {selectedTicket.status === 'resolved' ? '已关闭' : '沟通中'}
                </span>
              </div>
            </div>

            <div ref={messagesRef} data-testid="support-ticket-message-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messagesLoading ? (
                <p className="py-8 text-center text-sm text-gray-500">正在加载消息...</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">暂无消息记录</p>
              ) : (
                messages.map(message => <MessageBubble key={message.id} message={message} />)
              )}
            </div>

            <div className="border-t border-white/10 p-4">
              {selectedTicket.status === 'resolved' ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  工单已关闭，如仍需帮助请提交新问题。
                </div>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    value={replyText}
                    onChange={event => onReplyTextChange(event.target.value)}
                    placeholder="继续补充问题或回复客服"
                    className="min-h-[84px]"
                  />
                  <Button
                    type="button"
                    variant="pink"
                    loading={replying}
                    icon={<SendHorizontal className="h-4 w-4" />}
                    onClick={onReplySubmit}
                  >
                    发送回复
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: TicketMessage }) {
  const isUser = message.authorRole === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-purple-600 text-white'
          : 'border border-white/10 bg-white/10 text-gray-100'
      }`}>
        <div className={`mb-1 flex items-center gap-2 text-[11px] ${isUser ? 'text-purple-100' : 'text-gray-500'}`}>
          <span>{isUser ? '我' : 'Lindyson 客服'}</span>
          <span>{message.createdAt}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
      </div>
    </div>
  );
}

function IssueForm({
  issueTitle,
  issueType,
  issuePriority,
  issueDescription,
  onTitleChange,
  onTypeChange,
  onPriorityChange,
  onDescriptionChange,
  onSubmit,
  submitting,
}: {
  issueTitle: string;
  issueType: string;
  issuePriority: Priority;
  issueDescription: string;
  onTitleChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onPriorityChange: (value: Priority) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="space-y-4">
      <Input
        label="问题标题"
        value={issueTitle}
        onChange={event => onTitleChange(event.target.value)}
        icon={<MessageSquare className="w-4 h-4" />}
        placeholder="简要描述你遇到的问题"
      />
      <OptionGroup label="问题类型" value={issueType} options={issueTypes} onChange={onTypeChange} />
      <div className="space-y-2">
        <label className="block text-xs text-gray-400">优先级</label>
        <div className="flex flex-wrap gap-2">
          {priorityOptions.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPriorityChange(option.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                issuePriority === option.value
                  ? 'bg-purple-600 text-white'
                  : 'border border-white/10 bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <Textarea
        label="问题描述"
        value={issueDescription}
        onChange={event => onDescriptionChange(event.target.value)}
        placeholder="请补充页面、操作步骤或报错信息"
        className="min-h-[120px]"
      />
      <Button type="button" variant="pink" size="lg" loading={submitting} disabled={submitting} onClick={onSubmit}>
        {submitting ? '正在提交' : '提交问题'}
      </Button>
    </div>
  );
}

function OptionGroup({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              value === option
                ? 'bg-purple-600 text-white'
                : 'border border-white/10 bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function InvoiceForm({
  invoiceableOrders,
  pagination,
  pageLoading,
  selectedOrderId,
  invoiceTitle,
  taxId,
  receiveEmail,
  invoiceNote,
  onOrderChange,
  onPageNavigate,
  onInvoiceTitleChange,
  onTaxIdChange,
  onReceiveEmailChange,
  onInvoiceNoteChange,
  onSubmit,
  submitting,
}: {
  invoiceableOrders: AdminOrder[];
  pagination?: CursorPaginationState;
  pageLoading?: boolean;
  selectedOrderId: string;
  invoiceTitle: string;
  taxId: string;
  receiveEmail: string;
  invoiceNote: string;
  onOrderChange: (value: string) => void;
  onPageNavigate: (position: PagePosition) => void;
  onInvoiceTitleChange: (value: string) => void;
  onTaxIdChange: (value: string) => void;
  onReceiveEmailChange: (value: string) => void;
  onInvoiceNoteChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs text-gray-400">关联订单</label>
        {invoiceableOrders.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
            当前账户暂无可申请发票的已支付订单。
          </div>
        ) : (
          <div className="space-y-2">
            {invoiceableOrders.map(order => {
              const selected = selectedOrderId === order.id;
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => onOrderChange(order.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-purple-500/60 bg-purple-500/15'
                      : 'border-white/10 bg-white/5 hover:border-purple-500/40 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{order.id}</p>
                      <p className="mt-1 text-xs text-gray-500">{order.planName} · {formatCnyFromCents(order.amount)} · {order.paidAt ?? order.createdAt}</p>
                    </div>
                    <span className="text-xs text-gray-400">可申请</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {pagination && (
          <PaginationFooter count={invoiceableOrders.length} totalItems={pagination.totalItems} totalPages={pagination.totalPages} unit="个" className="pt-2">
            <CursorPagination
              pagination={pagination}
              loading={pageLoading}
              empty={pagination.totalItems === 0}
              onNavigate={onPageNavigate}
              label="可开票订单翻页"
            />
          </PaginationFooter>
        )}
      </div>
      <Input label="发票抬头" value={invoiceTitle} onChange={event => onInvoiceTitleChange(event.target.value)} placeholder="公司或个人抬头" />
      <Input label="税号" value={taxId} onChange={event => onTaxIdChange(event.target.value)} placeholder="纳税人识别号" />
      <Input label="接收邮箱" value={receiveEmail} onChange={event => onReceiveEmailChange(event.target.value)} icon={<Mail className="w-4 h-4" />} placeholder="invoice@example.com" />
      <Textarea
        label="补充说明"
        value={invoiceNote}
        onChange={event => onInvoiceNoteChange(event.target.value)}
        placeholder="可填写开票备注、公司地址等补充信息"
        className="min-h-[96px]"
      />
      <Button type="button" variant="pink" size="lg" loading={submitting} disabled={submitting} onClick={onSubmit}>
        {submitting ? '正在提交' : '提交发票申请'}
      </Button>
    </div>
  );
}

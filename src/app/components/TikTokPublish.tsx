import { CheckCircle2,ChevronDown,Clock,Download,Film,Image as ImageIcon,ListVideo,Loader2,Plus,Share2,Upload,User } from "lucide-react";
import { AnimatePresence,motion } from "motion/react";
import { useRef,useState } from "react";
import type { ExactCursorPagination,PagePosition } from "../api/cursor";
import type { UploadProgressEvent } from "../api/assetUpload";
import type { Asset,AssetFolder,AssetSource,AssetSummary } from "../data/assets";
import { AppPage,AssetThumbnail,Card,PageHeader } from "../ui";
import { getAssetThumbnailUrl } from "../utils/assetPreview";
import { AssetPickerModal } from "./AssetPickerModal";

type Tab = "commerce" | "traffic";
type CoverTab = "default" | "upload" | "capture";
type PublishStatus = "queued" | "publishing" | "done" | "failed";

interface PublishItem {
  id: string;
  cover: string | null;
  account: string;
  time: string;
  status: PublishStatus;
  type: Tab;
  title: string;
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={enabled} onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-10 rounded-full transition-colors duration-[var(--motion-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${enabled ? "bg-purple-600" : "bg-gray-600"}`}>
      <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-200 mt-1 ${enabled ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );
}

const MOCK_ACCOUNTS = ["@lindyson_official", "@brand_store_hk", "@creator_pro"];

const STATUS_CONFIG: Record<PublishStatus, { label: string; color: string }> = {
  queued:     { label: "分析中",  color: "bg-purple-500/20 text-purple-300" },
  publishing: { label: "发布中",  color: "bg-yellow-500/15 text-yellow-400" },
  done:       { label: "已发布",  color: "bg-green-500/15 text-green-400" },
  failed:     { label: "失败",    color: "bg-red-500/15 text-red-400" },
};

interface TikTokPublishProps {
  assets: Asset[];
  folders: AssetFolder[];
  assetSummary: AssetSummary;
  assetPagination?: ExactCursorPagination;
  assetPageLoading: boolean;
  assetPageError?: unknown;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetsPrepare: () => void;
  onAssetFiltersChange: (filters: { source?: AssetSource; folderId?: string | null; search?: string }) => void;
  onAssetPageNavigate: (position: PagePosition) => void;
  onAssetPageRetry: () => void;
  onNavigate: (tab: string) => void;
}

export function TikTokPublish({ assets, folders, assetSummary, assetPagination, assetPageLoading, assetPageError, onUploadFile, onAssetsPrepare, onAssetFiltersChange, onAssetPageNavigate, onAssetPageRetry, onNavigate }: TikTokPublishProps) {
  const [activeTab, setActiveTab] = useState<Tab>("commerce");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [coverTab, setCoverTab] = useState<CoverTab>("default");
  const [titleText, setTitleText] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [precheck, setPrecheck] = useState<"api" | "direct">("direct");
  const [scheduled, setScheduled] = useState(false);
  const [publishType, setPublishType] = useState<"publish" | "draft">("publish");
  const [aiContent, setAiContent] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [ownBusiness, setOwnBusiness] = useState(false);
  const [noComment, setNoComment] = useState(false);
  const [noDuet, setNoDuet] = useState(false);
  const [noStitch, setNoStitch] = useState(false);
  const [trafficScheduled, setTrafficScheduled] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [selectedPublishAssets, setSelectedPublishAssets] = useState<Asset[]>([]);
  const [publishList, setPublishList] = useState<PublishItem[]>([]);
  const idRef = useRef(0);
  const selectedImages = selectedPublishAssets.filter(asset => asset.type === "image");
  const selectedVideo = selectedPublishAssets.find(asset => asset.type === "video") ?? null;

  const coverTabs: { key: CoverTab; label: string }[] = [
    { key: "default", label: "默认封面" },
    { key: "upload",  label: "手动上传" },
    { key: "capture", label: "视频截取" },
  ];

  const handlePublish = () => {
    if (!selectedAccount || selectedPublishAssets.length === 0) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const newItem: PublishItem = {
      id: `p-${++idRef.current}`,
      cover: selectedPublishAssets[0] ? getAssetThumbnailUrl(selectedPublishAssets[0]) ?? null : null,
      account: selectedAccount,
      time: timeStr,
      status: "queued",
      type: activeTab,
      title: titleText || "未命名视频",
    };
    setPublishList(prev => [newItem, ...prev]);
    setIsPublishing(true);
    setTimeout(() => {
      setPublishList(prev => prev.map(i => i.id === newItem.id ? { ...i, status: "publishing" } : i));
    }, 400);
    setTimeout(() => {
      setIsPublishing(false);
      setPublishList(prev => prev.map(i => i.id === newItem.id ? { ...i, status: "done" } : i));
    }, 3000);
  };

  return (
    <AppPage width="workspace" padded={false} className="h-full min-h-0 overflow-y-auto xl:overflow-hidden">
      <div className="grid min-h-full grid-cols-1 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
      {/* Left panel */}
      <section className="flex min-h-0 w-full flex-col border-b border-[var(--product-border-subtle)] bg-[var(--product-surface-base)] xl:h-full xl:border-b-0 xl:border-r">
        {/* Tabs */}
        <div className="shrink-0 px-4 pt-5 sm:px-5 sm:pt-6">
          <PageHeader
            eyebrow="PUBLISH WORKSPACE"
            title="发布至 TikTok 账号"
            subtitle="将素材快速发布到已授权的 TikTok 账号"
            titleTone="solid"
          />
          <div className="mt-5 flex gap-1 rounded-xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-1">
            {(["commerce", "traffic"] as Tab[]).map((key) => (
              <button key={key} type="button" onClick={() => setActiveTab(key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-[color,background-color,box-shadow] duration-[var(--motion-standard)] ${activeTab === key ? "bg-white/[0.09] text-white shadow-sm ring-1 ring-inset ring-white/10" : "text-gray-400 hover:bg-white/[0.04] hover:text-white"}`}>
                {key === "commerce" ? "发布带货内容" : "发布流量内容"}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable form */}
        <div className="space-y-4 px-4 py-4 sm:px-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">

          {/* 选择账号 */}
          <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">选择账号</span>
              <button type="button" onClick={() => onNavigate('tiktok-accounts')} className="text-xs text-purple-400 hover:text-purple-300">管理授权账号</button>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setAccountOpen(o => !o)}
                className="flex w-full items-center gap-2 rounded-xl border border-[var(--product-border-subtle)] bg-black/20 px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.05]">
                <User size={15} className="text-gray-500 flex-shrink-0" />
                <span className={`flex-1 text-left ${selectedAccount ? "text-white" : "text-gray-500"}`}>{selectedAccount || "请选择账号"}</span>
                <ChevronDown size={15} className={`text-gray-500 transition-transform ${accountOpen ? "rotate-180" : ""}`} />
              </button>
              {accountOpen && (
                <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-xl border border-[var(--product-border-default)] bg-[var(--product-surface-floating)] shadow-[var(--product-shadow-floating)]">
                  {MOCK_ACCOUNTS.map(acc => (
                    <button key={acc} type="button" onClick={() => { setSelectedAccount(acc); setAccountOpen(false); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${selectedAccount === acc ? "bg-purple-600/20 text-purple-300" : "text-gray-300 hover:bg-white/5"}`}>
                      {acc}
                      {selectedAccount === acc && <CheckCircle2 size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Commerce only: 选择商品 + 商品标题 */}
          {activeTab === "commerce" && (
            <>
              <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white mb-2">选择商品 <span className="text-red-400">*</span></div>
                <button type="button" className="w-full flex items-center justify-center gap-2 border border-dashed border-white/20 rounded-xl py-3 text-sm text-gray-400 hover:bg-white/5 transition-colors">
                  <Plus size={15} /><span>选择商品</span>
                </button>
              </div>
              <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white mb-2">商品标题 <span className="text-red-400">*</span></div>
                <div className="relative">
                  <input type="text" maxLength={30} value={productTitle} onChange={e => setProductTitle(e.target.value)}
                    placeholder="请输入商品标题"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 pr-16" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{productTitle.length} / 30</span>
                </div>
              </div>
            </>
          )}

          {/* 选择素材 */}
          <Card variant="raised" accent={selectedPublishAssets.length > 0 ? "blue" : "none"} className="space-y-3 p-4" aria-labelledby="tiktok-publish-assets-title">
            <div className="flex items-center justify-between">
              <div id="tiktok-publish-assets-title" className="text-sm font-semibold text-white">选择素材 <span className="text-red-400">*</span></div>
              {activeTab === "commerce" && (
                <button type="button" className="text-xs text-purple-400 hover:text-purple-300">⇒ 批量发布</button>
              )}
            </div>
            <button type="button" onClick={() => setAssetPickerOpen(true)}
              className="group flex h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/15 transition-[border-color,background-color] duration-[var(--motion-standard)] hover:border-purple-500/40 hover:bg-white/[0.04]">
              {selectedVideo ? (
                <div className="flex items-center gap-3 px-4">
                  <div className="w-12 h-16 rounded-lg overflow-hidden flex-shrink-0">
                    <AssetThumbnail asset={selectedVideo} className="h-full w-full" iconClassName="h-5 w-5 opacity-80" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm text-white truncate">{selectedVideo.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{selectedVideo.size} · {selectedVideo.duration}</p>
                    <p className="text-xs text-purple-400 mt-1">点击重新选择</p>
                  </div>
                </div>
              ) : selectedImages.length > 0 ? (
                <div className="flex items-center gap-3 px-4">
                  <div className="grid grid-cols-2 gap-1 w-16 h-16 flex-shrink-0">
                    {selectedImages.slice(0, 4).map(asset => (
                      <div key={asset.id} className="overflow-hidden rounded-md bg-black/30">
                        <AssetThumbnail asset={asset} className="h-full w-full" iconClassName="h-4 w-4 opacity-80" />
                      </div>
                    ))}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm text-white truncate">已选择 {selectedImages.length} 张图片</p>
                    <p className="text-xs text-gray-500 mt-1">图片组发布素材</p>
                    <p className="text-xs text-purple-400 mt-1">点击重新选择</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-gray-500 group-hover:text-purple-400 transition-colors">
                    <Film size={24} />
                    <ImageIcon size={24} />
                  </div>
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">从数字资产选择素材</span>
                  <span className="text-xs text-gray-600">图片最多 35 张，视频最多 1 个</span>
                </>
              )}
            </button>
          </Card>

          {/* 封面图 */}
          <div className="space-y-3 rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
            <div className="text-sm font-semibold text-white">封面图</div>
            <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
              {coverTabs.map(ct => (
                <button key={ct.key} type="button" onClick={() => setCoverTab(ct.key)}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-lg transition-colors ${coverTab === ct.key ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"}`}>
                  {ct.label}
                </button>
              ))}
            </div>
            {coverTab === "upload" && (
              <label className="block cursor-pointer">
                <input type="file" accept="image/*" className="hidden" />
                <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-white/20 rounded-xl h-20 hover:bg-white/5 transition-colors">
                  <Upload size={18} className="text-gray-500" /><span className="text-xs text-gray-400">点击上传封面图</span>
                </div>
              </label>
            )}
            {coverTab === "capture" && (
              <div className="flex items-center justify-center h-20 border border-dashed border-white/20 rounded-xl">
                <span className="text-xs text-gray-500">请先上传视频后截取封面</span>
              </div>
            )}
          </div>

          {/* 视频标题 */}
          <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
            <div className="text-sm font-semibold text-white mb-2">视频标题 <span className="text-red-400">*</span></div>
            <div className="relative">
              <textarea rows={4} maxLength={4000} value={titleText} onChange={e => setTitleText(e.target.value)}
                placeholder="请输入视频标题，添加话题请使用：#话题"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none pb-6" />
              <span className="absolute right-3 bottom-2.5 text-xs text-gray-500">{titleText.length} / 4000</span>
            </div>
          </div>

          {/* Commerce only: 预检 + 定时 */}
          {activeTab === "commerce" && (
            <>
              <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white mb-3">预检选项</div>
                <div className="flex gap-2">
                  {([["api", "TikTok API预检查"], ["direct", "直接发布"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setPrecheck(k)}
                      className={`flex-1 text-sm py-2 rounded-xl border transition-colors ${precheck === k ? "bg-purple-600 border-purple-600 text-white" : "bg-white/5 border-white/10 text-gray-400 hover:text-white"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="flex items-center gap-2"><Clock size={15} className="text-gray-400" /><span className="text-sm font-semibold text-white">定时发布</span></div>
                <Toggle enabled={scheduled} onChange={setScheduled} />
              </div>
            </>
          )}

          {/* Traffic only */}
          {activeTab === "traffic" && (
            <>
              <div className="rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white mb-3">发布类型</div>
                <div className="flex gap-2">
                  {([["publish", "发布"], ["draft", "草稿"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setPublishType(k)}
                      className={`flex-1 text-sm py-2 rounded-xl border transition-colors ${publishType === k ? "bg-purple-600 border-purple-600 text-white" : "bg-white/5 border-white/10 text-gray-400 hover:text-white"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white">内容标注</div>
                {([["AI 生成内容", aiContent, setAiContent], ["第三方付费合作推广内容", thirdParty, setThirdParty], ["自有业务推广内容", ownBusiness, setOwnBusiness]] as const).map(([label, val, set]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{label}</span>
                    <Toggle enabled={val} onChange={set} />
                  </div>
                ))}
              </div>
              <div className="space-y-3 rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="text-sm font-semibold text-white">权限设置</div>
                {([["禁止评论", noComment, setNoComment], ["禁止合拍", noDuet, setNoDuet], ["禁止拼接创作", noStitch, setNoStitch]] as const).map(([label, val, set]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{label}</span>
                    <Toggle enabled={val} onChange={set} />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4">
                <div className="flex items-center gap-2"><Clock size={15} className="text-gray-400" /><span className="text-sm font-semibold text-white">定时发布</span></div>
                <Toggle enabled={trafficScheduled} onChange={setTrafficScheduled} />
              </div>
            </>
          )}
        </div>

        {/* Bottom button */}
        <div className="shrink-0 border-t border-[var(--product-border-subtle)] bg-[var(--product-surface-base)] p-4 sm:p-5">
          <button type="button" onClick={handlePublish} disabled={!selectedAccount || selectedPublishAssets.length === 0 || isPublishing}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white relative overflow-hidden transition-opacity ${!selectedAccount || selectedPublishAssets.length === 0 || isPublishing ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`}>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600"></div>
            <div className="relative flex items-center gap-2">
              {isPublishing ? <><Loader2 size={15} className="animate-spin" />发布中...</> : <><Upload size={15} />创建发布任务</>}
            </div>
          </button>
        </div>
      </section>

      {/* Right panel: publish list */}
      <section className="flex min-h-[420px] min-w-0 flex-col gap-4 overflow-hidden p-4 sm:p-5 xl:min-h-0">
        <div className="flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ListVideo size={16} className="text-purple-400" />发布列表
          </h3>
          <span className="text-xs text-gray-500">{publishList.length} 个任务</span>
        </div>

        {publishList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
            <ListVideo size={40} className="mb-3 opacity-20" />
            <p className="text-sm">暂无发布任务</p>
            <p className="text-xs mt-1">创建任务后将在此显示</p>
          </div>
        ) : (
          <div className="flex-1 space-y-3 pr-1 xl:min-h-0 xl:overflow-y-auto">
            {publishList.map((item) => (
              <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}
                className="group flex items-center gap-3 rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-3">
                {/* Cover */}
                <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  {item.cover ? (
                    <img src={item.cover} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film size={18} className="text-gray-600" />
                    </div>
                  )}
                  {/* type badge */}
                  <div className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${item.type === "commerce" ? "bg-orange-500/80" : "bg-blue-500/80"} text-white`}>
                    {item.type === "commerce" ? "带货" : "流量"}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-sm font-medium text-white truncate">{item.title}</p>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <User size={12} className="flex-shrink-0" />
                    <span className="truncate">{item.account}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock size={12} className="flex-shrink-0" />{item.time}
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[item.status].color}`}>
                    {item.status === "publishing" && <Loader2 size={10} className="animate-spin" />}
                    {item.status === "done" && <CheckCircle2 size={10} />}
                    {STATUS_CONFIG[item.status].label}
                  </span>
                </div>

                {/* Actions */}
                {item.status === "done" && (
                  <div className="flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="w-7 h-7 rounded-lg bg-white/10 hover:bg-purple-500/30 flex items-center justify-center transition-colors">
                      <Download size={13} className="text-gray-300" />
                    </button>
                    <button className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                      <Share2 size={13} className="text-gray-300" />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </section>
      </div>
      <AnimatePresence>
        {assetPickerOpen && (
          <AssetPickerModal
            assets={assets}
            folders={folders}
            assetSummary={assetSummary}
            pagination={assetPagination}
            pageLoading={assetPageLoading}
            pageError={assetPageError}
            defaultCategory="ai-video"
            mode="multi"
            accept="visual"
            showAllCategory={false}
            enableFolders
            selectionRules={{ maxImages: 35, maxVideos: 1, allowMixedTypes: false }}
            uploadAccept="visual"
            onUploadFile={onUploadFile}
            onAssetsPrepare={onAssetsPrepare}
            onAssetFiltersChange={onAssetFiltersChange}
            onAssetPageNavigate={onAssetPageNavigate}
            onAssetPageRetry={onAssetPageRetry}
            onClose={() => setAssetPickerOpen(false)}
            onConfirm={(assets) => {
              setSelectedPublishAssets(assets);
              setAssetPickerOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </AppPage>
  );
}

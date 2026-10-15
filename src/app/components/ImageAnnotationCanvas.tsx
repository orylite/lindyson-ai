import { BoxSelect,Hand,MapPin,Minus,Plus,RotateCcw,Trash2,Undo2 } from 'lucide-react';
import { useEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent,type ReactNode } from 'react';
import type { ImageGenerationAnnotation } from '../data/admin';
import type { AssetReferenceImage } from '../data/assets';
import { Button,Card } from '../ui';

export type ImageAnnotationTool = 'point' | 'bbox' | 'pan';

interface ImageAnnotationCanvasProps {
  asset: AssetReferenceImage | null;
  annotations: ImageGenerationAnnotation[];
  onChange: (annotations: ImageGenerationAnnotation[], removedTokens?: string[]) => void;
  onInsertToken: (token: string) => void;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

interface BboxDraft {
  start: NormalizedPoint;
  end: NormalizedPoint;
}

export function normalizeBboxCoordinates(start: NormalizedPoint, end: NormalizedPoint) {
  return {
    x1: Math.min(start.x, end.x),
    y1: Math.min(start.y, end.y),
    x2: Math.max(start.x, end.x),
    y2: Math.max(start.y, end.y),
  };
}

export function normalizeImagePoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clampOutside = false,
): NormalizedPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (!clampOutside && (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height)) {
    return null;
  }
  return {
    x: clampCoordinate(Math.round(((clientX - rect.left) / rect.width) * 1000)),
    y: clampCoordinate(Math.round(((clientY - rect.top) / rect.height) * 1000)),
  };
}

export function nextAnnotationToken(annotations: ImageGenerationAnnotation[]): `@标记${number}` {
  const largest = annotations.reduce((max, annotation) => {
    const value = Number(annotation.token.replace('@标记', ''));
    return Number.isInteger(value) && value > max ? value : max;
  }, 0);
  return `@标记${largest + 1}`;
}

export function removeAnnotationToken(prompt: string, token: string) {
  return prompt
    .replace(new RegExp(`${escapeRegExp(token)}(?!\\d)`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function getImageAnnotationCanvasBackgroundStyle(gridActive: boolean): CSSProperties {
  if (!gridActive) {
    return {
      backgroundColor: '#090912',
      backgroundImage: 'none',
    };
  }

  return {
    backgroundColor: '#090912',
    backgroundImage: [
      'linear-gradient(to right, rgba(244, 114, 182, 0.045) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(244, 114, 182, 0.045) 1px, transparent 1px)',
      'linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px)',
      'linear-gradient(to bottom, rgba(255, 255, 255, 0.035) 1px, transparent 1px)',
    ].join(', '),
    backgroundPosition: 'center center',
    backgroundSize: '96px 96px, 96px 96px, 24px 24px, 24px 24px',
  };
}

export function ImageAnnotationCanvas({ asset, annotations, onChange, onInsertToken }: ImageAnnotationCanvasProps) {
  const [tool, setTool] = useState<ImageAnnotationTool>('point');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [bboxDraft, setBboxDraft] = useState<BboxDraft | null>(null);
  const [panDrag, setPanDrag] = useState<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageAnnotations = useMemo(
    () => asset ? annotations.filter(annotation => annotation.assetId === asset.id) : [],
    [annotations, asset],
  );
  const previewUrl = asset?.publicUrl || asset?.thumbnailUrl || asset?.thumbnail || '';
  const previewKey = asset && previewUrl ? `${asset.id}:${previewUrl}` : '';
  const [previewLoadResult, setPreviewLoadResult] = useState<{ key: string; status: 'ready' | 'failed' } | null>(null);
  const previewStatus = previewLoadResult?.key === previewKey
    ? previewLoadResult.status
    : previewUrl
      ? 'loading'
      : 'idle';
  const previewReady = Boolean(asset && previewUrl && previewStatus === 'ready');
  const previewFailed = Boolean(asset && previewUrl && previewStatus === 'failed');

  useEffect(() => {
    setSelectedToken(null);
    setBboxDraft(null);
    setPanDrag(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [asset?.id, previewUrl]);

  const normalizedEventPoint = (event: ReactPointerEvent, clampOutside = false) => {
    const rect = imageRef.current?.getBoundingClientRect();
    return rect ? normalizeImagePoint(event.clientX, event.clientY, rect, clampOutside) : null;
  };

  const addPoint = (point: NormalizedPoint) => {
    if (!asset || !previewReady) return;
    const annotation: ImageGenerationAnnotation = {
      token: nextAnnotationToken(annotations),
      assetId: asset.id,
      type: 'point',
      ...point,
    };
    onChange([...annotations, annotation]);
    onInsertToken(annotation.token);
    setSelectedToken(annotation.token);
  };

  const addBbox = (draft: BboxDraft) => {
    if (!asset || !previewReady) return;
    const { x1, y1, x2, y2 } = normalizeBboxCoordinates(draft.start, draft.end);
    if (x2 - x1 < 5 || y2 - y1 < 5) return;
    const annotation: ImageGenerationAnnotation = {
      token: nextAnnotationToken(annotations),
      assetId: asset.id,
      type: 'bbox',
      x1,
      y1,
      x2,
      y2,
    };
    onChange([...annotations, annotation]);
    onInsertToken(annotation.token);
    setSelectedToken(annotation.token);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewReady) return;
    if (tool === 'pan') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanDrag({ clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y });
      return;
    }
    const point = normalizedEventPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'point') addPoint(point);
    else setBboxDraft({ start: point, end: point });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDrag) {
      setPan({
        x: panDrag.x + event.clientX - panDrag.clientX,
        y: panDrag.y + event.clientY - panDrag.clientY,
      });
      return;
    }
    if (!bboxDraft) return;
    const point = normalizedEventPoint(event, true);
    if (point) setBboxDraft(current => current ? { ...current, end: point } : null);
  };

  const finishPointerAction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPanDrag(null);
    if (bboxDraft) {
      const end = normalizedEventPoint(event, true) ?? bboxDraft.end;
      addBbox({ ...bboxDraft, end });
    }
    setBboxDraft(null);
  };

  const deleteAnnotation = (token: string) => {
    onChange(annotations.filter(annotation => annotation.token !== token), [token]);
    setSelectedToken(current => current === token ? null : current);
  };

  const undoLast = () => {
    if (imageAnnotations.length === 0) return;
    deleteAnnotation(imageAnnotations[imageAnnotations.length - 1].token);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const selectedAnnotation = annotations.find(annotation => annotation.token === selectedToken);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="图片标记工具">
          <ToolButton active={tool === 'point'} label="点选" icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => setTool('point')} />
          <ToolButton active={tool === 'bbox'} label="框选" icon={<BoxSelect className="h-3.5 w-3.5" />} onClick={() => setTool('bbox')} />
          <ToolButton active={tool === 'pan'} label="平移" icon={<Hand className="h-3.5 w-3.5" />} onClick={() => setTool('pan')} />
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={CANVAS_ICON_BUTTON_CLASS} aria-label="缩小画布" onClick={() => setZoom(current => Math.max(0.5, Number((current - 0.25).toFixed(2))))}><Minus className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
          <button type="button" className={CANVAS_ICON_BUTTON_CLASS} aria-label="放大画布" onClick={() => setZoom(current => Math.min(3, Number((current + 0.25).toFixed(2))))}><Plus className="h-4 w-4" /></button>
          <button type="button" className={CANVAS_ICON_BUTTON_CLASS} aria-label="重置画布" onClick={resetView}><RotateCcw className="h-4 w-4" /></button>
          <button type="button" className={CANVAS_ICON_BUTTON_CLASS} aria-label="撤销最后一个标记" disabled={imageAnnotations.length === 0} onClick={undoLast}><Undo2 className="h-4 w-4" /></button>
          <button type="button" className={`${CANVAS_ICON_BUTTON_CLASS} text-red-300`} aria-label="删除选中标记" disabled={!selectedAnnotation} onClick={() => selectedAnnotation && deleteAnnotation(selectedAnnotation.token)}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div
        data-testid="image-annotation-canvas"
        data-ui="image-annotation-canvas"
        data-grid-state={previewReady ? 'active' : 'inactive'}
        aria-label="图片精准标记画布"
        className={`product-media-surface relative flex h-[430px] touch-none select-none items-center justify-center overflow-hidden ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        style={getImageAnnotationCanvasBackgroundStyle(previewReady)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerAction}
        onPointerCancel={finishPointerAction}
      >
        {!asset ? (
          <p className="max-w-sm px-6 text-center text-sm leading-6 text-gray-500">选择参考图片后，可在这里使用点选或框选添加精准编辑标记。</p>
        ) : !previewUrl || previewFailed ? (
          <p className="max-w-sm px-6 text-center text-sm leading-6 text-amber-300">这张参考图的预览地址已失效，请重新选择素材。</p>
        ) : (
          <div
            className="relative inline-flex max-h-[390px] max-w-[calc(100%-2rem)]"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
          >
            <img
              key={previewKey}
              ref={imageRef}
              src={previewUrl}
              alt={asset.name}
              draggable={false}
              className="block max-h-[390px] max-w-full object-contain"
              onLoad={() => setPreviewLoadResult({ key: previewKey, status: 'ready' })}
              onError={() => {
                setPreviewLoadResult({ key: previewKey, status: 'failed' });
                setBboxDraft(null);
                setPanDrag(null);
              }}
            />
            <div className="pointer-events-none absolute inset-0">
              {imageAnnotations.map(annotation => (
                <AnnotationOverlay
                  key={annotation.token}
                  annotation={annotation}
                  selected={selectedToken === annotation.token}
                  onSelect={() => setSelectedToken(annotation.token)}
                />
              ))}
              {bboxDraft && <BboxPreview draft={bboxDraft} />}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">当前图片标记：</span>
          {imageAnnotations.length === 0 && <span className="text-xs text-gray-600">暂无</span>}
          {imageAnnotations.map(annotation => (
            <button
              key={annotation.token}
              type="button"
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${selectedToken === annotation.token ? 'border-pink-400/60 bg-pink-500/15 text-pink-200' : 'border-white/10 bg-white/5 text-gray-300 hover:border-pink-400/40'}`}
              onClick={() => {
                setSelectedToken(annotation.token);
                onInsertToken(annotation.token);
              }}
            >
              {annotation.token} · {annotation.type === 'point' ? '点' : '框'}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ToolButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant={active ? 'pink' : 'secondary'} icon={icon} onClick={onClick}>
      {label}
    </Button>
  );
}

function AnnotationOverlay({ annotation, selected, onSelect }: { annotation: ImageGenerationAnnotation; selected: boolean; onSelect: () => void }) {
  if (annotation.type === 'point') {
    return (
      <button
        type="button"
        className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg ${selected ? 'h-6 w-6 border-white bg-pink-500' : 'h-5 w-5 border-white/90 bg-purple-500'}`}
        style={{ left: `${annotation.x / 9.99}%`, top: `${annotation.y / 9.99}%` }}
        title={annotation.token}
        aria-label={`选择 ${annotation.token}`}
        onPointerDown={event => event.stopPropagation()}
        onClick={onSelect}
      >
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">{annotation.token}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`pointer-events-auto absolute border-2 ${selected ? 'border-pink-400 bg-pink-500/15' : 'border-purple-400 bg-purple-500/10'}`}
      style={{
        left: `${annotation.x1 / 9.99}%`,
        top: `${annotation.y1 / 9.99}%`,
        width: `${(annotation.x2 - annotation.x1) / 9.99}%`,
        height: `${(annotation.y2 - annotation.y1) / 9.99}%`,
      }}
      title={annotation.token}
      aria-label={`选择 ${annotation.token}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={onSelect}
    >
      <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t bg-purple-500 px-1.5 py-0.5 text-[10px] text-white">{annotation.token}</span>
    </button>
  );
}

function BboxPreview({ draft }: { draft: BboxDraft }) {
  const x1 = Math.min(draft.start.x, draft.end.x);
  const y1 = Math.min(draft.start.y, draft.end.y);
  const x2 = Math.max(draft.start.x, draft.end.x);
  const y2 = Math.max(draft.start.y, draft.end.y);
  return (
    <div
      className="absolute border-2 border-dashed border-pink-300 bg-pink-500/10"
      style={{ left: `${x1 / 9.99}%`, top: `${y1 / 9.99}%`, width: `${(x2 - x1) / 9.99}%`, height: `${(y2 - y1) / 9.99}%` }}
    />
  );
}

function clampCoordinate(value: number) {
  return Math.max(0, Math.min(999, value));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CANVAS_ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35';

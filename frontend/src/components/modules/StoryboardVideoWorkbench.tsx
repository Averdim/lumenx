"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Layout,
    Image as ImageIcon,
    FileText,
    Zap,
    Loader2,
    X,
    Plus,
    Trash2,
    Copy,
    ArrowUp,
    ArrowDown,
    Upload,
    Film,
    Lock,
    Unlock,
    Clapperboard,
    MapPin,
    Users,
} from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api, API_URL, crudApi, mergeAssetGlobalPrompt, type VideoTask } from "@/lib/api";
import { getAssetUrl, getAssetUrlWithTimestamp, extractErrorDetail } from "@/lib/utils";
import { buildFrameReferenceThumbnails, getSelectedVariantUrl, type FrameReferenceThumb } from "@/lib/storyboardRefs";
import CharacterDetailModal from "./CharacterDetailModal";
import CharacterWorkbench from "./CharacterWorkbench";
import StoryboardFrameEditor from "./StoryboardFrameEditor";
import StoryboardFirstFramePromptColumn from "./StoryboardFirstFramePromptColumn";
import {
    I2V_MODELS,
    SEEDANCE_20_MODEL_ID,
    type SeedanceI2vMode,
    type VideoParams,
} from "@/store/projectStore";
import R2VStoryboardPanel from "./R2VStoryboardPanel";
import VideoQueue from "./VideoQueue";

function normalizeImageForApi(img: string): string {
    if (!img) return img;
    if (img.startsWith(`${API_URL}/files/`)) {
        return img.replace(`${API_URL}/files/`, "");
    }
    return img;
}

function FrameWorkbenchRow({
    project,
    frame,
    index,
    total,
    selected,
    onSelect,
    rendering,
    onRender,
    onDelete,
    onCopy,
    onMove,
    onUploadClick,
    onOpenEditor,
    onToggleLock,
    onExtractPrev,
    extractBusy,
    prevVideoReady,
    videoPrompt,
    onVideoPromptChange,
    params,
    onParamsPatch,
    onSubmitVideo,
    videoBusy,
    tasksForFrame,
    onOpenAssetRef,
}: {
    project: any;
    frame: any;
    index: number;
    total: number;
    selected: boolean;
    onSelect: () => void;
    rendering: boolean;
    onRender: (batch: number) => void;
    onDelete: (e: React.MouseEvent) => void;
    onCopy: (e: React.MouseEvent) => void;
    onMove: (dir: "up" | "down", e: React.MouseEvent) => void;
    onUploadClick: (e: React.MouseEvent) => void;
    onOpenEditor: (e: React.MouseEvent) => void;
    onToggleLock: (e: React.MouseEvent) => void;
    onExtractPrev: (e: React.MouseEvent) => void;
    extractBusy: boolean;
    prevVideoReady: boolean;
    videoPrompt: string;
    onVideoPromptChange: (v: string) => void;
    params: RowVideoParams;
    onParamsPatch: (p: Partial<RowVideoParams>) => void;
    onSubmitVideo: () => void;
    videoBusy: boolean;
    tasksForFrame: any[];
    onOpenAssetRef: (thumb: FrameReferenceThumb) => void;
}) {
    const thumbs = useMemo(() => buildFrameReferenceThumbnails(project, frame), [project, frame]);
    const frameSceneName = useMemo(() => {
        if (!frame.scene_id) return null;
        return project.scenes?.find((s: any) => s.id === frame.scene_id)?.name ?? null;
    }, [frame.scene_id, project.scenes]);
    const frameCharacterNames = useMemo(() => {
        const ids: string[] = frame.character_ids || [];
        if (!ids.length) return [] as string[];
        return ids.map(
            (id: string) => project.characters?.find((c: any) => c.id === id)?.name?.trim() || id.slice(0, 8)
        );
    }, [frame.character_ids, project.characters]);

    const compositionScene = useMemo(() => {
        if (!frame.scene_id) return null;
        return project.scenes?.find((s: any) => s.id === frame.scene_id) ?? null;
    }, [frame.scene_id, project.scenes]);
    const compositionCharacters = useMemo(() => {
        const ids: string[] = frame.character_ids || [];
        return ids
            .map((id: string) => project.characters?.find((c: any) => c.id === id))
            .filter(Boolean) as any[];
    }, [frame.character_ids, project.characters]);
    const compositionProps = useMemo(() => {
        const ids: string[] = frame.prop_ids || [];
        return ids.map((id: string) => project.props?.find((p: any) => p.id === id)).filter(Boolean) as any[];
    }, [frame.prop_ids, project.props]);

    const [refCompositionOpen, setRefCompositionOpen] = useState(false);

    const primaryRaw = frame.rendered_image_url || frame.image_url || "";
    const primaryDisplay = primaryRaw ? getAssetUrlWithTimestamp(primaryRaw, frame.updated_at) : "";
    const isSeedance20 = params.model === SEEDANCE_20_MODEL_ID;
    /** 多图参考不依赖本分镜首帧图；保留剧情/对白，隐藏首帧相关区 */
    const isMultimodalRef = isSeedance20 && params.seedanceI2vMode === "multimodal_ref";
    const showFirstFrameImageColumn = !isMultimodalRef;

    const completed = tasksForFrame.filter((t: any) => t.status === "completed" && t.video_url);
    const sorted = [...completed].sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0));
    const selectedTask = frame.selected_video_id
        ? tasksForFrame.find((t: any) => t.id === frame.selected_video_id && t.status === "completed" && t.video_url)
        : null;
    const latestPreview = selectedTask?.video_url
        ? getAssetUrl(selectedTask.video_url)
        : sorted[0]?.video_url
          ? getAssetUrl(sorted[0].video_url)
          : null;
    const pending = tasksForFrame.some((t: any) => t.status === "pending" || t.status === "processing");

    const handleSelectVideo = async (videoId: string) => {
        if (!videoId) return;
        try {
            await api.selectVideo(project.id, frame.id, videoId);
            const updated = await api.getProject(project.id);
            useProjectStore.getState().updateProject(project.id, updated);
        } catch (e) {
            console.error(e);
            alert("Failed to select video");
        }
    };

    return (
        <>
        <div
            onClick={onSelect}
            className={`flex-shrink-0 flex flex-col rounded-xl border transition-all cursor-pointer ${
                selected ? "bg-white/8 border-primary ring-1 ring-primary" : "bg-[#141414] border-white/10 hover:border-white/20"
            }`}
        >
            <div
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-white/10 px-2 py-1.5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex min-w-0 max-w-full items-center gap-1.5 text-[10px] leading-tight">
                    <MapPin size={11} className="shrink-0 text-gray-500" aria-hidden />
                    <span className="shrink-0 font-semibold uppercase tracking-wide text-gray-500">场景</span>
                    <span className="min-w-0 truncate text-gray-200" title={frameSceneName || undefined}>
                        {frameSceneName || "—"}
                    </span>
                </div>
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[10px] leading-tight">
                    <Users size={11} className="shrink-0 text-gray-500" aria-hidden />
                    <span className="shrink-0 font-semibold uppercase tracking-wide text-gray-500">角色</span>
                    <span className="break-words text-gray-200" title={frameCharacterNames.join("、") || undefined}>
                        {frameCharacterNames.length ? frameCharacterNames.join("、") : "—"}
                    </span>
                </div>
            </div>

            <div className="flex min-h-[12rem] items-stretch gap-1.5 p-2 pb-1.5">
                <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="w-7 h-7 rounded-full bg-[#222] border border-white/10 flex items-center justify-center text-[10px] font-bold text-gray-400">
                        {index + 1}
                    </span>
                    <div className="flex flex-col gap-0.5">
                        <button
                            type="button"
                            onClick={(e) => onMove("up", e)}
                            disabled={index === 0}
                            className="p-1 rounded hover:bg-white/10 text-gray-500 disabled:opacity-30"
                            title="上移"
                        >
                            <ArrowUp size={12} />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => onMove("down", e)}
                            disabled={index >= total - 1}
                            className="p-1 rounded hover:bg-white/10 text-gray-500 disabled:opacity-30"
                            title="下移"
                        >
                            <ArrowDown size={12} />
                        </button>
                        <button type="button" onClick={onCopy} className="p-1 rounded hover:bg-white/10 text-gray-500" title="复制">
                            <Copy size={12} />
                        </button>
                        {prevVideoReady ? (
                            <button
                                type="button"
                                onClick={onExtractPrev}
                                disabled={extractBusy}
                                className="p-1 rounded hover:bg-purple-500/20 text-gray-500"
                                title="上一镜尾帧"
                            >
                                {extractBusy ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                            </button>
                        ) : null}
                        <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-red-500/20 text-gray-500" title="删除">
                            <Trash2 size={12} />
                        </button>
                    </div>
                </div>

                <div
                    className="flex w-[7.25rem] shrink-0 flex-col gap-1 border-r border-white/10 pr-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-0.5">
                        <span className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">Refs</span>
                        <button
                            type="button"
                            title="查看场景、人物与道具"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[13px] leading-none text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
                            onClick={(e) => {
                                e.stopPropagation();
                                setRefCompositionOpen(true);
                            }}
                        >
                            👤
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {thumbs.length === 0 ? (
                            <span className="text-[10px] text-gray-600">—</span>
                        ) : (
                            thumbs.slice(0, 6).map((t, i) => (
                                <button
                                    key={`${t.assetId}-${t.refKind}-${i}`}
                                    type="button"
                                    title={`${t.label}（点击查看素材）`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenAssetRef(t);
                                    }}
                                    className="h-12 w-12 overflow-hidden rounded border border-white/10 object-cover ring-offset-2 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/60"
                                >
                                    <img src={getAssetUrl(t.url)} alt="" className="h-full w-full object-cover" />
                                </button>
                            ))
                        )}
                    </div>
                    {isMultimodalRef ? (
                        <button
                            type="button"
                            title="上传首帧图片"
                            onClick={(e) => {
                                e.stopPropagation();
                                onUploadClick(e);
                            }}
                            className="flex w-full items-center justify-center gap-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[9px] text-gray-400 hover:border-primary/40 hover:text-white"
                        >
                            <Upload size={11} />
                            上传首帧
                        </button>
                    ) : null}
                </div>

                <div
                    className="flex min-h-0 min-w-0 flex-1 flex-row items-stretch gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div
                        className={`flex h-full min-h-0 min-w-0 flex-col gap-1.5 border-r border-white/10 pr-2 sm:flex-row ${
                            isMultimodalRef ? "flex-1 basis-0 min-w-0" : "flex-1"
                        }`}
                    >
                        <StoryboardFirstFramePromptColumn
                            frameId={frame.id}
                            hideFirstFrameSection={isMultimodalRef}
                            className="h-full min-h-0 min-w-0 w-full flex-1 basis-0"
                        />
                        {showFirstFrameImageColumn ? (
                            <div className="flex w-[8.25rem] shrink-0 flex-col items-center gap-1 sm:items-start">
                                <div className="relative aspect-video w-[8.25rem] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                                    {primaryDisplay ? (
                                        <img
                                            src={primaryDisplay}
                                            alt=""
                                            className="h-full w-full cursor-pointer object-cover"
                                            onClick={onOpenEditor}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            title="打开首帧编辑器，或使用右下角 ×1 / ×2 直接生成"
                                            onClick={onOpenEditor}
                                            className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-600 transition-colors hover:bg-white/5 hover:text-gray-400"
                                        >
                                            <ImageIcon size={20} className="opacity-30" />
                                            <span className="px-1 text-center text-[9px] leading-tight text-gray-500">
                                                点击生成
                                            </span>
                                        </button>
                                    )}
                                    {!frame.locked ? (
                                        <div className="absolute bottom-1 right-1 z-[1] flex gap-0.5">
                                            {[1, 2].map((size) => (
                                                <button
                                                    key={size}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onRender(size);
                                                    }}
                                                    disabled={rendering}
                                                    className="rounded bg-primary/90 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50"
                                                    title={`生成 ${size} 张首帧`}
                                                >
                                                    ×{size}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    {rendering ? (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                            <Loader2 className="animate-spin text-white" size={18} />
                                        </div>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    title="上传首帧图片"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onUploadClick(e);
                                    }}
                                    className="flex w-full max-w-[8.25rem] items-center justify-center gap-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-gray-400 hover:border-primary/40 hover:text-white"
                                >
                                    <Upload size={12} />
                                    上传首帧
                                </button>
                                <button
                                    type="button"
                                    onClick={onToggleLock}
                                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white"
                                >
                                    {frame.locked ? <Unlock size={10} /> : <Lock size={10} />}
                                    {frame.locked ? "Unlock" : "Lock"}
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <div
                        className={`flex h-full min-h-0 flex-col gap-1.5 border-r border-white/10 pr-2 ${
                            isMultimodalRef
                                ? "min-w-0 flex-1 basis-0"
                                : "w-full max-w-[19rem] shrink-0 sm:w-[19rem] sm:max-w-[19rem]"
                        }`}
                    >
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                            <Clapperboard size={10} className="inline" /> Video
                        </span>
                        <textarea
                            value={videoPrompt}
                            onChange={(e) => onVideoPromptChange(e.target.value)}
                            placeholder="Video prompt…"
                            className="min-h-[4rem] w-full flex-1 resize-none overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1.5 text-xs text-gray-200 focus:border-primary/50 focus:outline-none"
                        />
                        {isSeedance20 && params.seedanceI2vMode === "multimodal_ref" ? (
                            <p className="shrink-0 text-[10px] leading-snug text-gray-500">
                                多图参考：仅使用左侧 Refs（场景 / 角色 / 道具资产图），自动附加，最多 9 张。
                            </p>
                        ) : null}
                    </div>

                    <div className="flex h-full min-h-0 w-[min(14rem,24vw)] shrink-0 flex-col gap-1.5 border-l border-white/10 pl-2 sm:w-[14rem]">
                        <div className="flex shrink-0 w-full flex-row flex-wrap items-center justify-between gap-2">
                            <select
                                value={params.duration}
                                onChange={(e) => onParamsPatch({ duration: Number(e.target.value) })}
                                className="min-w-0 shrink rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-200"
                                title="生成时长"
                            >
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 15].map((d) => (
                                    <option key={d} value={d}>
                                        {d}s
                                    </option>
                                ))}
                            </select>
                            <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={onSubmitVideo}
                                    disabled={videoBusy || (frame.locked || (!primaryRaw && !(isSeedance20 && params.seedanceI2vMode === "multimodal_ref")))}
                                    className="whitespace-nowrap rounded-lg bg-emerald-600/90 px-2.5 py-1 text-[10px] text-white hover:bg-emerald-600 disabled:opacity-40"
                                >
                                    {videoBusy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}
                                    生成视频
                                </button>
                                {pending ? <span className="text-[9px] text-amber-400">处理中</span> : null}
                            </div>
                        </div>
                        <div className="shrink-0 flex flex-col gap-1">
                            <select
                                value={params.model}
                                onChange={(e) => onParamsPatch({ model: e.target.value })}
                                className="w-full rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-200"
                            >
                                {I2V_MODELS.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={isSeedance20 ? params.seedanceI2vMode : "first_frame"}
                                onChange={(e) => onParamsPatch({ seedanceI2vMode: e.target.value as SeedanceI2vMode })}
                                disabled={!isSeedance20}
                                className={`w-full rounded border px-2 py-1 text-[10px] ${
                                    isSeedance20
                                        ? "border-white/10 bg-black/50 text-gray-200"
                                        : "border-white/10 bg-black/30 text-gray-500 cursor-not-allowed"
                                }`}
                            >
                                <option value="first_frame">首帧</option>
                                <option value="multimodal_ref">多图参考</option>
                            </select>
                        </div>
                        <span className="shrink-0 text-[9px] font-bold uppercase text-gray-500">Preview</span>
                        {latestPreview ? (
                            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/70">
                                <video
                                    src={latestPreview}
                                    className="h-full min-h-[6rem] w-full flex-1 object-contain"
                                    controls
                                    muted
                                    playsInline
                                />
                            </div>
                        ) : (
                            <div className="flex min-h-[6rem] flex-1 items-center justify-center rounded-lg border border-white/10 bg-black/70 px-2 text-center text-[10px] text-gray-600">
                                无成片
                            </div>
                        )}
                        {sorted.length > 0 ? (
                            <select
                                className="w-full shrink-0 rounded border border-white/10 bg-black/50 px-2 py-1.5 text-[10px] text-gray-300"
                                value={frame.selected_video_id || ""}
                                onChange={(e) => void handleSelectVideo(e.target.value)}
                                title="选择用于合成与预览的成片版本"
                            >
                                <option value="">选择成片（默认最新）</option>
                                {sorted.map((t: any) => (
                                    <option key={t.id} value={t.id}>
                                        {t.id.slice(0, 8)}… {t.status}
                                    </option>
                                ))}
                            </select>
                        ) : null}
                    </div>
                </div>
            </div>

        </div>

        <AnimatePresence>
            {refCompositionOpen ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
                    onClick={() => setRefCompositionOpen(false)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                        onClick={(e) => e.stopPropagation()}
                        className="max-h-[min(72vh,32rem)] w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl flex flex-col"
                    >
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
                            <h3 className="text-sm font-bold text-white">分镜引用</h3>
                            <button
                                type="button"
                                onClick={() => setRefCompositionOpen(false)}
                                className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="overflow-y-auto overscroll-contain px-4 py-3 space-y-4 text-xs">
                            <section>
                                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">场景</div>
                                {compositionScene ? (
                                    <div className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
                                        {(getSelectedVariantUrl(compositionScene.image_asset) || compositionScene.image_url) ? (
                                            <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-white/10 bg-black/50">
                                                <img
                                                    src={getAssetUrl(
                                                        getSelectedVariantUrl(compositionScene.image_asset) || compositionScene.image_url
                                                    )}
                                                    alt=""
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>
                                        ) : null}
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-gray-200">{compositionScene.name || "—"}</div>
                                            {compositionScene.description ? (
                                                <p className="mt-1 text-[10px] leading-snug text-gray-500">{compositionScene.description}</p>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-gray-600">未选择场景</p>
                                )}
                            </section>

                            <section>
                                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">人物</div>
                                {compositionCharacters.length ? (
                                    <ul className="space-y-2">
                                        {compositionCharacters.map((char: any) => (
                                            <li
                                                key={char.id}
                                                className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-2"
                                            >
                                                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-gray-800">
                                                    {char.avatar_url ? (
                                                        <img src={getAssetUrl(char.avatar_url)} alt="" className="h-full w-full object-cover" />
                                                    ) : null}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-gray-200">{char.name || "—"}</div>
                                                    {char.description ? (
                                                        <p className="mt-0.5 text-[10px] leading-snug text-gray-500 italic">{char.description}</p>
                                                    ) : null}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-[10px] text-gray-600">未选择角色</p>
                                )}
                            </section>

                            <section>
                                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">道具</div>
                                {compositionProps.length ? (
                                    <ul className="space-y-2">
                                        {compositionProps.map((prop: any) => (
                                            <li
                                                key={prop.id}
                                                className="flex gap-2 rounded-lg border border-white/10 bg-black/30 p-2"
                                            >
                                                <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-white/10 bg-gray-800">
                                                    {prop.image_url ? (
                                                        <img src={getAssetUrl(prop.image_url)} alt="" className="h-full w-full object-cover" />
                                                    ) : null}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-gray-200">{prop.name || "—"}</div>
                                                    {prop.description ? (
                                                        <p className="mt-0.5 text-[10px] leading-snug text-gray-500 italic">{prop.description}</p>
                                                    ) : null}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-[10px] text-gray-600">未选择道具</p>
                                )}
                            </section>
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
        </>
    );
}

type RowVideoParams = {
    model: string;
    duration: number;
    resolution: string;
    generateAudio: boolean;
    audioUrl: string;
    promptExtend: boolean;
    negativePrompt: string;
    seed: number | undefined;
    shotType: string;
    mode: string;
    sound: boolean;
    cfgScale: number;
    viduAudio: boolean;
    movementAmplitude: string;
    seedanceI2vMode: SeedanceI2vMode;
};

const ROW_VIDEO_PARAMS_STORAGE_KEY = "lumenx_storyboard_row_video_params_v1";

function loadPersistedRowVideoParams(projectId: string): Record<string, RowVideoParams> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(ROW_VIDEO_PARAMS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, Record<string, RowVideoParams>>;
        return parsed?.[projectId] || {};
    } catch {
        return {};
    }
}

function persistRowVideoParams(projectId: string, frameParams: Record<string, RowVideoParams>) {
    if (typeof window === "undefined") return;
    try {
        const raw = window.localStorage.getItem(ROW_VIDEO_PARAMS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, Record<string, RowVideoParams>>) : {};
        parsed[projectId] = frameParams;
        window.localStorage.setItem(ROW_VIDEO_PARAMS_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
        // Ignore localStorage failures (private mode/quota) and keep in-memory behavior.
    }
}

function createDefaultRowVideoParams(model: string): RowVideoParams {
    return {
        model,
        duration: 5,
        resolution: "720p",
        generateAudio: true,
        audioUrl: "",
        promptExtend: true,
        negativePrompt: "",
        seed: undefined,
        shotType: "single",
        mode: "std",
        sound: false,
        cfgScale: 0.5,
        viduAudio: true,
        movementAmplitude: "auto",
        seedanceI2vMode: "first_frame",
    };
}

function applyRowVideoParamsPatch(prev: RowVideoParams, patch: Partial<RowVideoParams>): RowVideoParams {
    const next = { ...prev, ...patch };
    if (patch.model !== undefined && patch.model !== SEEDANCE_20_MODEL_ID) {
        next.seedanceI2vMode = "first_frame";
    }
    if (patch.seedanceI2vMode === "first_last_frame") {
        next.seedanceI2vMode = "first_frame";
    }
    return next;
}

export default function StoryboardVideoWorkbench() {
    const currentProject = useProjectStore((s) => s.currentProject);
    const selectedFrameId = useProjectStore((s) => s.selectedFrameId);
    const setSelectedFrameId = useProjectStore((s) => s.setSelectedFrameId);
    const updateProject = useProjectStore((s) => s.updateProject);
    const renderingFrames = useProjectStore((s) => s.renderingFrames);
    const addRenderingFrame = useProjectStore((s) => s.addRenderingFrame);
    const removeRenderingFrame = useProjectStore((s) => s.removeRenderingFrame);
    const isAnalyzing = useProjectStore((s) => s.isAnalyzingStoryboard);
    const setIsAnalyzing = useProjectStore((s) => s.setIsAnalyzingStoryboard);
    const generatingTasks = useProjectStore((s) => s.generatingTasks || []);
    const addGeneratingTask = useProjectStore((s) => s.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((s) => s.removeGeneratingTask);

    const [showScriptOverlay, setShowScriptOverlay] = useState(false);
    const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [insertIndex, setInsertIndex] = useState<number | null>(null);
    const [extractingFrameId, setExtractingFrameId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadTargetFrameId, setUploadTargetFrameId] = useState<string | null>(null);

    type RefAssetOpenTarget = {
        refKind: FrameReferenceThumb["refKind"];
        assetId: string;
        characterSlot?: FrameReferenceThumb["characterSlot"];
    };
    const [refAssetTarget, setRefAssetTarget] = useState<RefAssetOpenTarget | null>(null);
    /** Minutes; empty = do not send episode duration planning to Prompt B */
    const [episodeDurationMinutes, setEpisodeDurationMinutes] = useState("");

    const [rowVideoPrompts, setRowVideoPrompts] = useState<Record<string, string>>({});
    const [videoBusyByFrame, setVideoBusyByFrame] = useState<Record<string, boolean>>({});
    const [rowVideoParamsByFrameId, setRowVideoParamsByFrameId] = useState<Record<string, RowVideoParams>>({});

    type StoryboardWorkbenchVideoMode = "i2v" | "r2v";
    const [workbenchVideoMode, setWorkbenchVideoMode] = useState<StoryboardWorkbenchVideoMode>("i2v");
    const [r2vPanelParams, setR2vPanelParams] = useState<VideoParams>(() => ({
        resolution: "720p",
        duration: 5,
        seed: undefined,
        generateAudio: true,
        audioUrl: "",
        promptExtend: true,
        negativePrompt: "",
        batchSize: 1,
        cameraMovement: "none",
        subjectMotion: "still",
        model: "wan2.6-i2v",
        shotType: "multi",
        generationMode: "r2v",
        referenceVideoUrls: [],
        referenceImageUrls: [],
        seedanceI2vMode: "first_frame",
        mode: "std",
        sound: false,
        cfgScale: 0.5,
        viduAudio: true,
        movementAmplitude: "auto",
    }));

    const frames = currentProject?.frames || [];
    const projectDefaultI2v = currentProject?.model_settings?.i2v_model || "wan2.5-i2v-preview";
    const frameIdKey = frames.map((f: any) => f.id).join(",");

    useEffect(() => {
        if (!currentProject) return;
        const projectModel = currentProject.model_settings?.i2v_model || "wan2.5-i2v-preview";
        const frameIds = (currentProject.frames || []).map((f: any) => f.id);
        const persisted = loadPersistedRowVideoParams(currentProject.id);
        setRowVideoParamsByFrameId((prev) => {
            const next: Record<string, RowVideoParams> = {};
            for (const id of frameIds) {
                next[id] = prev[id] ?? persisted[id] ?? createDefaultRowVideoParams(projectModel);
            }
            return next;
        });
    }, [currentProject?.id, frameIdKey, currentProject?.model_settings?.i2v_model]);

    useEffect(() => {
        if (!currentProject?.id) return;
        persistRowVideoParams(currentProject.id, rowVideoParamsByFrameId);
    }, [currentProject?.id, rowVideoParamsByFrameId]);
    const tasks = currentProject?.video_tasks || [];

    const r2vQueueTasks = useMemo(
        () => (tasks as VideoTask[]).filter((t) => t.generation_mode === "r2v" || t.model === "wan2.6-r2v"),
        [tasks]
    );

    const [r2vRemixNonce, setR2vRemixNonce] = useState(0);
    const [r2vRemixTask, setR2vRemixTask] = useState<VideoTask | null>(null);

    const handleR2VQueueRemix = useCallback(
        (task: VideoTask) => {
            setR2vPanelParams((prev) => ({
                ...prev,
                duration: task.duration ?? prev.duration,
                seed: task.seed ?? prev.seed,
                resolution: task.resolution || prev.resolution,
                generateAudio: task.generate_audio ?? prev.generateAudio,
                audioUrl: task.audio_url ?? prev.audioUrl,
                promptExtend: task.prompt_extend ?? prev.promptExtend,
                negativePrompt: task.negative_prompt ?? prev.negativePrompt,
                referenceVideoUrls:
                    task.reference_video_urls && task.reference_video_urls.length > 0
                        ? [...task.reference_video_urls]
                        : prev.referenceVideoUrls,
            }));
            if (task.frame_id) setSelectedFrameId(task.frame_id);
            setR2vRemixTask(task);
            setR2vRemixNonce((n) => n + 1);
        },
        [setSelectedFrameId]
    );

    useEffect(() => {
        const hasActive = tasks.some((t: any) => t.status === "pending" || t.status === "processing");
        if (!hasActive || !currentProject) return;
        const interval = setInterval(async () => {
            try {
                const project = await api.getProject(currentProject.id);
                if (project.video_tasks) {
                    updateProject(currentProject.id, { video_tasks: project.video_tasks });
                }
            } catch (e) {
                console.error(e);
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [tasks, currentProject?.id, updateProject]);

    useEffect(() => {
        setRowVideoPrompts((prev) => {
            const next = { ...prev };
            for (const f of frames) {
                if (next[f.id] === undefined) {
                    let p = f.image_prompt || f.action_description || "";
                    if (f.dialogue) p += `${p ? " " : ""}(Dialogue: ${f.dialogue})`;
                    next[f.id] = p;
                }
            }
            return next;
        });
    }, [frames.map((f: any) => f.id).join(",")]);

    const getCompositionData = useCallback(
        (frame: any) => {
            if (!currentProject) return null;
            const compositionData: any = {
                character_ids: frame.character_ids,
                prop_ids: frame.prop_ids,
                scene_id: frame.scene_id,
                reference_image_urls: [],
            };
            if (frame.scene_id) {
                const scene = currentProject.scenes?.find((s: any) => s.id === frame.scene_id);
                if (scene) {
                    const sceneUrl = getSelectedVariantUrl(scene.image_asset) || scene.image_url;
                    if (sceneUrl) compositionData.reference_image_urls.push(sceneUrl);
                }
            }
            if (frame.character_ids?.length) {
                frame.character_ids.forEach((charId: string) => {
                    const char = currentProject.characters?.find((c: any) => c.id === charId);
                    if (!char) return;
                    const charUrl =
                        getSelectedVariantUrl(char.three_view_asset) ||
                        getSelectedVariantUrl(char.full_body_asset) ||
                        getSelectedVariantUrl(char.headshot_asset) ||
                        char.three_view_image_url ||
                        char.full_body_image_url ||
                        char.headshot_image_url ||
                        char.avatar_url ||
                        char.image_url;
                    if (charUrl) compositionData.reference_image_urls.push(charUrl);
                });
            }
            if (frame.prop_ids?.length) {
                frame.prop_ids.forEach((propId: string) => {
                    const prop = currentProject.props?.find((p: any) => p.id === propId);
                    if (!prop) return;
                    const propUrl = getSelectedVariantUrl(prop.image_asset) || prop.image_url;
                    if (propUrl) compositionData.reference_image_urls.push(propUrl);
                });
            }
            return compositionData;
        },
        [currentProject]
    );

    const handleRenderFrame = async (frame: any, batchSize: number) => {
        if (!currentProject) return;
        addRenderingFrame(frame.id);
        try {
            const compositionData = getCompositionData(frame);
            const artDirection = currentProject.art_direction;
            const globalStylePrompt = artDirection?.style_config?.positive_prompt || "";
            let finalPrompt = "";
            if (frame.image_prompt?.trim()) {
                finalPrompt = globalStylePrompt ? `${globalStylePrompt} . ${frame.image_prompt}` : frame.image_prompt;
            } else {
                const parts = [globalStylePrompt, frame.action_description, frame.dialogue ? `Dialogue context: "${frame.dialogue}"` : ""].filter(Boolean);
                finalPrompt = parts.join(" . ");
            }
            await api.renderFrame(currentProject.id, frame.id, compositionData, finalPrompt, batchSize);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (e) {
            console.error(e);
            alert("Render failed");
        } finally {
            removeRenderingFrame(frame.id);
        }
    };

    const handleAnalyzeToStoryboard = async () => {
        if (!currentProject) return;
        const text = currentProject.originalText;
        if (!text?.trim()) {
            alert("请先输入剧本文本");
            return;
        }
        if (currentProject.frames?.length > 0) {
            if (!confirm("这将覆盖当前的所有分镜帧。是否继续？")) return;
        }
        setIsAnalyzing(true);
        try {
            const trimmed = episodeDurationMinutes.trim();
            const minutes = trimmed === "" ? NaN : parseFloat(trimmed);
            const episodeSeconds =
                Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : undefined;

            const updatedProject = await api.analyzeToStoryboard(currentProject.id, text, {
                episode_duration_seconds: episodeSeconds,
            });
            const frameCount = updatedProject.frames?.length || 0;
            if (frameCount > 0) {
                updateProject(currentProject.id, updatedProject);
                setRowVideoParamsByFrameId((prev) => {
                    const next = { ...prev };
                    for (const f of updatedProject.frames || []) {
                        const base =
                            prev[f.id] ?? createDefaultRowVideoParams(SEEDANCE_20_MODEL_ID);
                        next[f.id] = {
                            ...base,
                            model: SEEDANCE_20_MODEL_ID,
                            duration: 4,
                            seedanceI2vMode: "first_frame",
                        };
                    }
                    return next;
                });
                alert(`成功生成 ${frameCount} 个分镜帧！`);
            } else {
                alert("AI 模型未生成有效分镜帧，请重试。");
            }
        } catch (error: any) {
            const detail = extractErrorDetail(error, "");
            alert(`分镜生成失败：${detail || "请查看控制台"}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const submitVideoForFrame = async (frame: any) => {
        if (!currentProject) return;
        const params =
            rowVideoParamsByFrameId[frame.id] ?? createDefaultRowVideoParams(projectDefaultI2v);
        const isSeedance20 = params.model === SEEDANCE_20_MODEL_ID;
        const isSeedance20Multimodal = isSeedance20 && params.seedanceI2vMode === "multimodal_ref";
        const primaryRaw = frame.rendered_image_url || frame.image_url;
        if (!primaryRaw && !isSeedance20Multimodal) {
            alert("请先生成首帧");
            return;
        }
        const rowPrompt = rowVideoPrompts[frame.id] || "";
        const motion = [frame.camera_movement, frame.camera_angle].filter(Boolean).join(", ");
        const finalPrompt = motion ? `${rowPrompt}, ${motion}` : rowPrompt;
        if (!finalPrompt.trim()) {
            alert("请填写视频提示词");
            return;
        }

        const primaryDisplay = primaryRaw ? getAssetUrl(primaryRaw) : "";
        let extras: string[] = [];
        if (params.model === SEEDANCE_20_MODEL_ID) {
            if (params.seedanceI2vMode === "multimodal_ref") {
                extras = buildFrameReferenceThumbnails(currentProject, frame)
                    .map((t) => getAssetUrl(t.url))
                    .filter(Boolean);
            }
        }

        let ordered: string[] = isSeedance20Multimodal ? [...extras] : [primaryDisplay, ...extras];
        const seen = new Set<string>();
        ordered = ordered.filter((u) => {
            if (!u || seen.has(u)) return false;
            seen.add(u);
            return true;
        });
        if (ordered.length > 9) {
            ordered = ordered.slice(0, 9);
        }

        if (isSeedance20) {
            const m = params.seedanceI2vMode;
            const n = ordered.length;
            if (m === "first_frame" && n !== 1) {
                alert("首帧模式仅使用本镜首图；请清空附加参考。");
                return;
            }
            if (m === "multimodal_ref" && (n < 1 || n > 9)) {
                alert("多图参考需要 1～9 张资产参考图。");
                return;
            }
        }

        setVideoBusyByFrame((b) => ({ ...b, [frame.id]: true }));
        try {
            if (isSeedance20 && ordered.length >= 1) {
                const normalized = ordered.map((img) => normalizeImageForApi(img));
                const first = normalized[0];
                const rest = normalized.slice(1);
                await api.createVideoTask(
                    currentProject.id,
                    first,
                    finalPrompt,
                    params.duration,
                    params.seed,
                    params.resolution,
                    params.generateAudio,
                    params.audioUrl,
                    params.promptExtend,
                    params.negativePrompt,
                    1,
                    params.model,
                    frame.id,
                    params.shotType,
                    "i2v",
                    [],
                    params.mode,
                    params.sound,
                    params.cfgScale,
                    params.viduAudio,
                    params.movementAmplitude,
                    rest.length ? rest : undefined,
                    params.seedanceI2vMode
                );
            } else {
                const img = normalizeImageForApi(primaryDisplay);
                await api.createVideoTask(
                    currentProject.id,
                    img,
                    finalPrompt,
                    params.duration,
                    params.seed,
                    params.resolution,
                    params.generateAudio,
                    params.audioUrl,
                    params.promptExtend,
                    params.negativePrompt,
                    1,
                    params.model,
                    frame.id,
                    params.shotType,
                    "i2v",
                    [],
                    params.mode,
                    params.sound,
                    params.cfgScale,
                    params.viduAudio,
                    params.movementAmplitude
                );
            }
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (e) {
            console.error(e);
            alert("视频任务提交失败");
        } finally {
            setVideoBusyByFrame((b) => ({ ...b, [frame.id]: false }));
        }
    };

    const refOpenAsset = useMemo(() => {
        if (!refAssetTarget || !currentProject) return null;
        const { refKind, assetId } = refAssetTarget;
        if (refKind === "character") {
            return currentProject.characters?.find((c: any) => c.id === assetId) ?? null;
        }
        if (refKind === "scene") {
            return currentProject.scenes?.find((s: any) => s.id === assetId) ?? null;
        }
        return currentProject.props?.find((p: any) => p.id === assetId) ?? null;
    }, [refAssetTarget, currentProject]);

    const refCharacterInitialPanel = useMemo((): "full_body" | "three_view" | "headshot" | undefined => {
        if (!refAssetTarget || refAssetTarget.refKind !== "character") return undefined;
        const s = refAssetTarget.characterSlot;
        if (s === "three_view") return "three_view";
        if (s === "headshot") return "headshot";
        return "full_body";
    }, [refAssetTarget]);

    const isAssetGenerating = (assetId: string) => generatingTasks.some((t: any) => t.assetId === assetId);
    const getAssetGeneratingTypes = (assetId: string) =>
        generatingTasks.filter((t: any) => t.assetId === assetId).map((t: any) => ({ type: t.generationType, batchSize: t.batchSize }));

    const handleRefUpdateDescription = async (assetId: string, type: string, description: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.updateAssetDescription(currentProject.id, assetId, type, description);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to update description:", error);
        }
    };

    const handleRefGenerate = async (
        assetId: string,
        type: string,
        generationType: string = "all",
        prompt: string = "",
        applyStyle: boolean = true,
        negativePrompt: string = "",
        batchSize: number = 1
    ) => {
        if (!currentProject) return;
        if (addGeneratingTask) addGeneratingTask(assetId, generationType, batchSize);
        try {
            const stylePrompt = currentProject?.art_direction?.style_config?.positive_prompt || "";
            const mergedPrompt = mergeAssetGlobalPrompt(type, prompt, currentProject.assetGlobalPrompts);
            const response = await api.generateAsset(
                currentProject.id,
                assetId,
                type,
                "ArtDirection",
                stylePrompt,
                generationType,
                mergedPrompt,
                applyStyle,
                negativePrompt,
                batchSize,
                currentProject.model_settings?.t2i_model
            );
            const taskId = response._task_id;
            if (taskId) {
                const pollInterval = setInterval(async () => {
                    try {
                        const status = await api.getTaskStatus(taskId);
                        if (status.status === "completed") {
                            clearInterval(pollInterval);
                            const updatedProject = await api.getProject(currentProject.id);
                            updateProject(currentProject.id, updatedProject);
                            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                        } else if (status.status === "failed") {
                            clearInterval(pollInterval);
                            console.error("Asset generation failed:", status.error);
                            alert(status.error || "生成失败，请稍后重试");
                            try {
                                const updatedProject = await api.getProject(currentProject.id);
                                updateProject(currentProject.id, updatedProject);
                            } catch (refreshError) {
                                console.error("Failed to refresh project:", refreshError);
                            }
                            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                        }
                    } catch (pollError: any) {
                        console.error("Polling error:", pollError);
                        clearInterval(pollInterval);
                        alert(`轮询任务状态失败: ${pollError.message || "网络错误"}`);
                        if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                    }
                }, 2000);
            } else {
                updateProject(currentProject.id, response);
                if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
            }
        } catch (error: any) {
            console.error("Failed to generate asset:", error);
            alert(`启动生成任务失败: ${error.response?.data?.detail || error.message}`);
            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
        }
    };

    const handleRefGenerateVideo = async (
        assetId: string,
        type: string,
        prompt: string,
        duration: number,
        assetSubType: string = "full_body"
    ) => {
        if (!currentProject) return;
        let finalAssetType: "full_body" | "head_shot" | "scene" | "prop" = "full_body";
        if (type === "scene") {
            finalAssetType = "scene";
        } else if (type === "prop") {
            finalAssetType = "prop";
        } else if (assetSubType === "head_shot") {
            finalAssetType = "head_shot";
        } else {
            finalAssetType = "full_body";
        }
        const generationType = assetSubType === "head_shot" ? "video_head_shot" : "video_full_body";
        if (addGeneratingTask) addGeneratingTask(assetId, generationType, 1);
        try {
            const response = await api.generateMotionRef(
                currentProject.id,
                assetId,
                finalAssetType,
                prompt,
                undefined,
                duration
            );
            const taskId = response._task_id;
            if (taskId) {
                const pollInterval = setInterval(async () => {
                    try {
                        const status = await api.getTaskStatus(taskId);
                        if (status.status === "completed") {
                            clearInterval(pollInterval);
                            const updatedProject = await api.getProject(currentProject.id);
                            updateProject(currentProject.id, updatedProject);
                            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                        } else if (status.status === "failed") {
                            clearInterval(pollInterval);
                            alert(`视频生成失败: ${status.error || "生成失败，请稍后重试"}`);
                            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                            const updatedProject = await api.getProject(currentProject.id);
                            updateProject(currentProject.id, updatedProject);
                        }
                    } catch (pollError: any) {
                        console.error("Video polling error:", pollError);
                        clearInterval(pollInterval);
                        alert(`视频轮询失败: ${pollError.message || "网络错误"}`);
                        if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
                    }
                }, 3000);
            } else {
                updateProject(currentProject.id, response);
                if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
            }
        } catch (error: any) {
            console.error("Failed to generate video:", error);
            alert(`启动视频生成失败: ${error.response?.data?.detail || error.message}`);
            if (removeGeneratingTask) removeGeneratingTask(assetId, generationType);
        }
    };

    const handleRefDeleteVideo = async (assetId: string, type: string, videoId: string) => {
        if (!currentProject) return;
        if (!confirm("Are you sure you want to delete this video? This action cannot be undone.")) return;
        try {
            await api.deleteAssetVideo(currentProject.id, type, assetId, videoId);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to delete video:", error);
            alert(`Failed to delete video: ${error.message}`);
        }
    };

    const onOpenAssetRef = useCallback((thumb: FrameReferenceThumb) => {
        setRefAssetTarget({
            refKind: thumb.refKind,
            assetId: thumb.assetId,
            characterSlot: thumb.characterSlot,
        });
    }, []);

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !uploadTargetFrameId || !currentProject) return;
        try {
            const updatedProject = await api.uploadFrameImage(currentProject.id, uploadTargetFrameId, file);
            updateProject(currentProject.id, updatedProject);
        } catch (err: any) {
            alert(err?.message || "Upload failed");
        } finally {
            setUploadTargetFrameId(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    if (!currentProject) return null;

    const renderFrameWorkbenchRows = () =>
        frames.map((frame: any, index: number) => {
                        const prevFrame = index > 0 ? frames[index - 1] : null;
                        const prevVideo =
                            prevFrame?.selected_video_id &&
                            tasks.find((t: any) => t.id === prevFrame.selected_video_id && t.status === "completed");
                        const tasksForFrame = tasks.filter((t: any) => t.frame_id === frame.id);
                        return (
                            <FrameWorkbenchRow
                                key={frame.id}
                                project={currentProject}
                                frame={frame}
                                index={index}
                                total={frames.length}
                                selected={selectedFrameId === frame.id}
                                onSelect={() => setSelectedFrameId(frame.id)}
                                rendering={renderingFrames.has(frame.id)}
                                onRender={(batch) => handleRenderFrame(frame, batch)}
                                onDelete={async (e) => {
                                    e.stopPropagation();
                                    if (!confirm("删除此分镜？")) return;
                                    await crudApi.deleteFrame(currentProject.id, frame.id);
                                    const p = await api.getProject(currentProject.id);
                                    updateProject(currentProject.id, p);
                                }}
                                onCopy={async (e) => {
                                    e.stopPropagation();
                                    await crudApi.copyFrame(currentProject.id, frame.id);
                                    const p = await api.getProject(currentProject.id);
                                    updateProject(currentProject.id, p);
                                }}
                                onMove={async (dir, e) => {
                                    e.stopPropagation();
                                    const newIndex = dir === "up" ? index - 1 : index + 1;
                                    if (newIndex < 0 || newIndex >= frames.length) return;
                                    const nf = [...frames];
                                    const [m] = nf.splice(index, 1);
                                    nf.splice(newIndex, 0, m);
                                    updateProject(currentProject.id, { ...currentProject, frames: nf });
                                    try {
                                        await crudApi.reorderFrames(
                                            currentProject.id,
                                            nf.map((f: any) => f.id)
                                        );
                                    } catch {
                                        const p = await api.getProject(currentProject.id);
                                        updateProject(currentProject.id, p);
                                    }
                                }}
                                onUploadClick={(e) => {
                                    e.stopPropagation();
                                    setUploadTargetFrameId(frame.id);
                                    fileInputRef.current?.click();
                                }}
                                onOpenEditor={(e) => {
                                    e.stopPropagation();
                                    setEditingFrameId(frame.id);
                                }}
                                onToggleLock={async (e) => {
                                    e.stopPropagation();
                                    await api.toggleFrameLock(currentProject.id, frame.id);
                                    const p = await api.getProject(currentProject.id);
                                    updateProject(currentProject.id, p);
                                }}
                                onExtractPrev={async (e) => {
                                    e.stopPropagation();
                                    if (!prevFrame?.selected_video_id) return;
                                    const pv = tasks.find(
                                        (t: any) => t.id === prevFrame.selected_video_id && t.status === "completed"
                                    );
                                    if (!pv) return;
                                    setExtractingFrameId(frame.id);
                                    try {
                                        const p = await api.extractLastFrame(currentProject.id, frame.id, pv.id);
                                        updateProject(currentProject.id, p);
                                    } catch (err: any) {
                                        alert(err?.response?.data?.detail || "提取失败");
                                    } finally {
                                        setExtractingFrameId(null);
                                    }
                                }}
                                extractBusy={extractingFrameId === frame.id}
                                prevVideoReady={!!prevVideo}
                                videoPrompt={rowVideoPrompts[frame.id] ?? ""}
                                onVideoPromptChange={(v) =>
                                    setRowVideoPrompts((prev) => ({
                                        ...prev,
                                        [frame.id]: v,
                                    }))
                                }
                                params={
                                    rowVideoParamsByFrameId[frame.id] ??
                                    createDefaultRowVideoParams(projectDefaultI2v)
                                }
                                onParamsPatch={(patch) =>
                                    setRowVideoParamsByFrameId((m) => {
                                        const prev =
                                            m[frame.id] ?? createDefaultRowVideoParams(projectDefaultI2v);
                                        return { ...m, [frame.id]: applyRowVideoParamsPatch(prev, patch) };
                                    })
                                }
                                onSubmitVideo={() => submitVideoForFrame(frame)}
                                videoBusy={!!videoBusyByFrame[frame.id]}
                                tasksForFrame={tasksForFrame}
                                onOpenAssetRef={onOpenAssetRef}
                            />
            );
        });

    return (
        <div className="flex flex-col h-full text-white overflow-hidden relative">
            {workbenchVideoMode === "i2v" ? (
                <>
                    <div className="flex-shrink-0 border-b border-white/10 bg-black/20">
                        <div className="p-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <h3 className="font-bold text-sm flex items-center gap-2 whitespace-nowrap">
                                    <Layout size={16} className="text-primary shrink-0" />
                                    <span className="hidden sm:inline">分镜与视频</span>
                                </h3>
                                <div className="flex bg-black/40 rounded-lg p-0.5 gap-0.5 border border-white/10 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setWorkbenchVideoMode("i2v")}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-xs transition-colors bg-white/10 text-white"
                                    >
                                        <ImageIcon size={12} />
                                        首帧 I2V
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWorkbenchVideoMode("r2v")}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-xs transition-colors text-gray-500 hover:text-gray-300"
                                    >
                                        <Film size={12} />
                                        角色 R2V
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <label className="flex items-center gap-1.5 text-[10px] text-gray-400 whitespace-nowrap">
                                        <span className="hidden sm:inline">本集时长</span>
                                        <span className="sm:hidden">时长</span>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.5}
                                            placeholder="分"
                                            value={episodeDurationMinutes}
                                            onChange={(e) => setEpisodeDurationMinutes(e.target.value)}
                                            className="w-14 sm:w-16 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[10px] text-gray-200 tabular-nums"
                                            title="选填：用于估算分镜条数（按每镜约 4 秒、Seedance 2.0 规划）。成片总长以各镜实际视频为准。"
                                        />
                                        <span className="text-gray-500">分</span>
                                    </label>
                                    <span className="text-[9px] text-gray-600 max-w-[11rem] sm:max-w-[14rem] leading-tight hidden sm:block">
                                        选填；估算条数用，成片总长可随后改每镜秒数
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowScriptOverlay(true)}
                                    className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5"
                                >
                                    <FileText size={12} /> 脚本
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAnalyzeToStoryboard}
                                    disabled={isAnalyzing}
                                    className="flex items-center gap-1 text-[10px] sm:text-xs bg-primary/80 hover:bg-primary px-2 py-1 rounded-lg disabled:opacity-50"
                                >
                                    {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                    生成分镜
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setInsertIndex(0);
                                        setIsCreateDialogOpen(true);
                                    }}
                                    className="flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-lg border border-dashed border-white/20 hover:border-primary text-gray-400"
                                >
                                    <Plus size={12} /> 开头插入
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setInsertIndex(frames.length);
                                        setIsCreateDialogOpen(true);
                                    }}
                                    className="flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-lg border border-dashed border-white/20 hover:border-primary text-gray-400"
                                >
                                    <Plus size={12} /> 末尾插入
                                </button>
                                <span className="text-[10px] text-gray-500 font-mono">{frames.length} 镜</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto p-3">
                        <div className="flex flex-col gap-2 w-full min-w-0 max-w-full">
                            {renderFrameWorkbenchRows()}
                            {frames.length === 0 ? (
                                <div className="text-center text-gray-500 text-sm py-16">
                                    暂无分镜。请先写剧本并点击「生成分镜」。
                                </div>
                            ) : null}
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <div className="shrink-0 border-b border-purple-500/25 bg-gradient-to-r from-[#140a18] via-[#0c0c10] to-black/95">
                        <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Film size={22} className="text-purple-400 shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="font-bold text-sm text-purple-100">角色驱动</h3>
                                    <p className="text-[10px] text-gray-500 font-mono">wan2.6-r2v</p>
                                </div>
                                <div className="flex bg-black/50 rounded-lg p-0.5 gap-0.5 border border-white/10 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setWorkbenchVideoMode("i2v")}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-xs transition-colors text-gray-500 hover:text-gray-300"
                                    >
                                        <ImageIcon size={12} />
                                        首帧 I2V
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWorkbenchVideoMode("r2v")}
                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] sm:text-xs transition-colors bg-purple-500/30 text-purple-100 ring-1 ring-purple-500/40"
                                    >
                                        <Film size={12} />
                                        角色 R2V
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowScriptOverlay(true)}
                                    className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10"
                                >
                                    <FileText size={12} /> 脚本
                                </button>
                                <span className="text-[10px] text-gray-500 font-mono tabular-nums">{frames.length} 镜</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden overflow-x-hidden bg-[#060606]">
                        {/* 左栏略宽（约 11:4），单滚动条、隐藏滚动条轨道 */}
                        <div className="min-h-0 min-w-0 flex flex-[11] flex-col border-b lg:border-b-0 lg:border-r border-purple-500/15">
                            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-6 sm:py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                <div className="mx-auto w-full max-w-3xl lg:max-w-5xl min-h-0 flex flex-col">
                                    <R2VStoryboardPanel
                                        fullBleed
                                        compact
                                        params={r2vPanelParams}
                                        onParamsChange={(patch) =>
                                            setR2vPanelParams((prev) => ({ ...prev, ...patch }))
                                        }
                                        selectedFrameId={selectedFrameId}
                                        onSelectedFrameIdChange={(id) => setSelectedFrameId(id)}
                                        remixTask={r2vRemixTask}
                                        remixNonce={r2vRemixNonce}
                                        onTaskCreated={(p) => {
                                            if (!currentProject?.id || !p?.video_tasks) return;
                                            updateProject(currentProject.id, { video_tasks: p.video_tasks });
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        {/* 右栏任务队列 */}
                        <div className="min-h-0 min-w-0 flex flex-[4] flex-col border-t lg:border-t-0 lg:border-l border-purple-500/20 bg-black/55">
                            <VideoQueue tasks={r2vQueueTasks} onRemix={handleR2VQueueRemix} />
                        </div>
                    </div>
                </>
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />

            <AnimatePresence>
                {showScriptOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                        onClick={() => setShowScriptOverlay(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-2xl max-h-[80vh] bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
                            onClick={(ev) => ev.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                                <h3 className="text-sm font-bold">原始脚本</h3>
                                <button type="button" onClick={() => setShowScriptOverlay(false)} className="p-1 hover:bg-white/10 rounded">
                                    <X size={16} />
                                </button>
                            </div>
                            <pre className="flex-1 overflow-y-auto p-4 text-sm text-gray-300 whitespace-pre-wrap">
                                {currentProject.originalText || "暂无"}
                            </pre>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {editingFrameId && currentProject.frames?.find((f: any) => f.id === editingFrameId) ? (
                    <StoryboardFrameEditor
                        frame={currentProject.frames.find((f: any) => f.id === editingFrameId)}
                        onClose={() => setEditingFrameId(null)}
                    />
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {isCreateDialogOpen ? (
                    <CreateFrameDialog
                        onClose={() => {
                            setIsCreateDialogOpen(false);
                            setInsertIndex(null);
                        }}
                        onCreate={async (data: any) => {
                            await crudApi.createFrame(currentProject.id, {
                                ...data,
                                insert_at: insertIndex !== null ? insertIndex : undefined,
                            });
                            const p = await api.getProject(currentProject.id);
                            updateProject(currentProject.id, p);
                            setIsCreateDialogOpen(false);
                            setInsertIndex(null);
                        }}
                        scenes={currentProject.scenes || []}
                    />
                ) : null}
            </AnimatePresence>

            <AnimatePresence>
                {refAssetTarget && refOpenAsset && refAssetTarget.refKind === "character" ? (
                    <CharacterWorkbench
                        key={`refs-wb-${refAssetTarget.assetId}-${refAssetTarget.characterSlot ?? "fb"}`}
                        asset={refOpenAsset}
                        initialActivePanel={refCharacterInitialPanel}
                        onClose={() => setRefAssetTarget(null)}
                        onUpdateDescription={(desc: string) =>
                            handleRefUpdateDescription(refAssetTarget.assetId, "character", desc)
                        }
                        onGenerate={(type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number) =>
                            handleRefGenerate(
                                refAssetTarget.assetId,
                                "character",
                                type,
                                prompt,
                                applyStyle,
                                negativePrompt,
                                batchSize
                            )
                        }
                        generatingTypes={getAssetGeneratingTypes(refAssetTarget.assetId)}
                        stylePrompt={currentProject.art_direction?.style_config?.positive_prompt || ""}
                        styleNegativePrompt={currentProject.art_direction?.style_config?.negative_prompt || ""}
                        onGenerateVideo={(prompt: string, duration: number, subType?: string) =>
                            handleRefGenerateVideo(
                                refAssetTarget.assetId,
                                "character",
                                prompt,
                                duration,
                                subType || "video"
                            )
                        }
                        onDeleteVideo={(videoId: string) =>
                            handleRefDeleteVideo(refAssetTarget.assetId, "character", videoId)
                        }
                    />
                ) : refAssetTarget && refOpenAsset && (refAssetTarget.refKind === "scene" || refAssetTarget.refKind === "prop") ? (
                    <CharacterDetailModal
                        asset={refOpenAsset}
                        type={refAssetTarget.refKind}
                        onClose={() => setRefAssetTarget(null)}
                        onUpdateDescription={(desc: string) =>
                            handleRefUpdateDescription(refAssetTarget.assetId, refAssetTarget.refKind, desc)
                        }
                        onGenerate={(applyStyle: boolean, negativePrompt: string, batchSize: number) =>
                            handleRefGenerate(
                                refAssetTarget.assetId,
                                refAssetTarget.refKind,
                                "all",
                                "",
                                applyStyle,
                                negativePrompt,
                                batchSize
                            )
                        }
                        isGenerating={isAssetGenerating(refAssetTarget.assetId)}
                        stylePrompt={currentProject.art_direction?.style_config?.positive_prompt || ""}
                        styleNegativePrompt={currentProject.art_direction?.style_config?.negative_prompt || ""}
                        onGenerateVideo={(prompt: string, duration: number) =>
                            handleRefGenerateVideo(refAssetTarget.assetId, refAssetTarget.refKind, prompt, duration, "video")
                        }
                        onDeleteVideo={(videoId: string) =>
                            handleRefDeleteVideo(refAssetTarget.assetId, refAssetTarget.refKind, videoId)
                        }
                        isGeneratingVideo={getAssetGeneratingTypes(refAssetTarget.assetId).some((t: any) =>
                            String(t.type).startsWith("video")
                        )}
                    />
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function CreateFrameDialog({
    onClose,
    onCreate,
    scenes,
}: {
    onClose: () => void;
    onCreate: (data: any) => Promise<void>;
    scenes: any[];
}) {
    const [action, setAction] = useState("");
    const [dialogue, setDialogue] = useState("");
    const [sceneId, setSceneId] = useState(scenes[0]?.id || "");
    const [busy, setBusy] = useState(false);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#1a1a1a] border border-white/10 rounded-xl w-full max-w-md p-4 space-y-3"
            >
                <div className="flex justify-between items-center">
                    <h2 className="font-bold text-white text-sm">新分镜</h2>
                    <button type="button" onClick={onClose} className="p-1 hover:bg-white/10 rounded">
                        <X size={16} />
                    </button>
                </div>
                <select
                    value={sceneId}
                    onChange={(e) => setSceneId(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
                >
                    {scenes.map((s: any) => (
                        <option key={s.id} value={s.id}>
                            {s.name}
                        </option>
                    ))}
                </select>
                <textarea
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    placeholder="动作描述 *"
                    rows={3}
                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white resize-none"
                />
                <textarea
                    value={dialogue}
                    onChange={(e) => setDialogue(e.target.value)}
                    placeholder="对白（可选）"
                    rows={2}
                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white resize-none"
                />
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-white/10">
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={busy || !action.trim()}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await onCreate({
                                    action_description: action.trim(),
                                    dialogue: dialogue.trim(),
                                    scene_id: sceneId,
                                    camera_angle: "Medium Shot",
                                });
                            } finally {
                                setBusy(false);
                            }
                        }}
                        className="px-3 py-1.5 text-sm rounded bg-primary disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="animate-spin inline" size={14} /> : null} 创建
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

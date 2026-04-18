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
    Link2,
} from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api, API_URL, crudApi } from "@/lib/api";
import { getAssetUrl, getAssetUrlWithTimestamp, extractErrorDetail } from "@/lib/utils";
import { buildFrameReferenceThumbnails, getSelectedVariantUrl } from "@/lib/storyboardRefs";
import StoryboardFrameEditor from "./StoryboardFrameEditor";
import StoryboardFrameContextFields from "./StoryboardFrameContextFields";
import StoryboardFirstFramePromptColumn from "./StoryboardFirstFramePromptColumn";
import {
    I2V_MODELS,
    SEEDANCE_20_MODEL_ID,
    SEEDANCE_15_MODEL_ID,
    type SeedanceI2vMode,
} from "@/store/projectStore";

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
    extraRefs,
    onAddExtraRef,
    onRemoveExtraRef,
    params,
    onParamsPatch,
    onSubmitVideo,
    videoBusy,
    tasksForFrame,
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
    extraRefs: string[];
    onAddExtraRef: (url: string) => void;
    onRemoveExtraRef: (i: number) => void;
    params: RowVideoParams;
    onParamsPatch: (p: Partial<RowVideoParams>) => void;
    onSubmitVideo: () => void;
    videoBusy: boolean;
    tasksForFrame: any[];
}) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const thumbs = useMemo(() => buildFrameReferenceThumbnails(project, frame), [project, frame]);
    const primaryRaw = frame.rendered_image_url || frame.image_url || "";
    const primaryDisplay = primaryRaw ? getAssetUrlWithTimestamp(primaryRaw, frame.updated_at) : "";
    const isSeedance20 = params.model === SEEDANCE_20_MODEL_ID;
    const isSeedance15 = params.model === SEEDANCE_15_MODEL_ID;
    const showExtraRefs = isSeedance20 && params.seedanceI2vMode !== "first_frame";

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
        <div
            onClick={onSelect}
            className={`flex-shrink-0 flex flex-col rounded-xl border transition-all cursor-pointer ${
                selected ? "bg-white/8 border-primary ring-1 ring-primary" : "bg-[#141414] border-white/10 hover:border-white/20"
            }`}
        >
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
                        <button type="button" onClick={onUploadClick} className="p-1 rounded hover:bg-blue-500/20 text-gray-500" title="上传">
                            <Upload size={12} />
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
                    <span className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">Refs</span>
                    <div className="flex flex-wrap gap-1">
                        {thumbs.length === 0 ? (
                            <span className="text-[10px] text-gray-600">—</span>
                        ) : (
                            thumbs.slice(0, 6).map((t, i) => (
                                <img
                                    key={`${t.url}-${i}`}
                                    src={getAssetUrl(t.url)}
                                    title={t.label}
                                    alt=""
                                    className="h-12 w-12 rounded border border-white/10 object-cover"
                                />
                            ))
                        )}
                    </div>
                </div>

                <div
                    className="flex min-h-0 min-w-0 flex-1 flex-row items-stretch gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-1.5 border-r border-white/10 pr-2 sm:flex-row">
                        <StoryboardFirstFramePromptColumn
                            frameId={frame.id}
                            className="h-full min-h-0 min-w-0 w-full flex-1 basis-0"
                        />
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
                                    <div className="flex h-full w-full items-center justify-center text-gray-600">
                                        <ImageIcon size={20} className="opacity-30" />
                                    </div>
                                )}
                                {!frame.locked && primaryDisplay ? (
                                    <div className="absolute bottom-1 right-1 flex gap-0.5">
                                        {[1, 2].map((size) => (
                                            <button
                                                key={size}
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRender(size);
                                                }}
                                                disabled={rendering}
                                                className="rounded bg-primary/90 px-1.5 py-0.5 text-[10px] text-white"
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
                                onClick={onToggleLock}
                                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white"
                            >
                                {frame.locked ? <Unlock size={10} /> : <Lock size={10} />}
                                {frame.locked ? "Unlock" : "Lock"}
                            </button>
                        </div>
                    </div>

                    <div className="flex h-full min-h-0 w-full max-w-[19rem] shrink-0 flex-col gap-1.5 border-r border-white/10 pr-2 sm:w-[19rem] sm:max-w-[19rem]">
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                            <Clapperboard size={10} className="inline" /> Video
                        </span>
                        <textarea
                            value={videoPrompt}
                            onChange={(e) => onVideoPromptChange(e.target.value)}
                            placeholder="Video prompt…"
                            className="min-h-[4rem] w-full flex-1 resize-none overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1.5 text-xs text-gray-200 focus:border-primary/50 focus:outline-none"
                        />

                        {showExtraRefs ? (
                            <div className="flex shrink-0 flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setPickerOpen((o) => !o)}
                                        className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/10"
                                    >
                                        <Link2 size={10} /> 其它分镜首帧
                                    </button>
                                    {extraRefs.map((u, i) => (
                                        <span
                                            key={`${u}-${i}`}
                                            className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-gray-300"
                                        >
                                            +{i + 1}
                                            <button type="button" className="text-red-400" onClick={() => onRemoveExtraRef(i)}>
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                {pickerOpen ? (
                                    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded border border-white/10 bg-black/60 p-1">
                                        {(project.frames || [])
                                            .filter((f: any) => f.id !== frame.id)
                                            .map((f: any) => {
                                                const u = f.rendered_image_url || f.image_url;
                                                if (!u) return null;
                                                const maxExtra =
                                                    params.seedanceI2vMode === "first_last_frame" ? 1 : 8;
                                                return (
                                                    <button
                                                        key={f.id}
                                                        type="button"
                                                        onClick={() => {
                                                            const display = getAssetUrl(u);
                                                            onAddExtraRef(display);
                                                            setPickerOpen(false);
                                                        }}
                                                        disabled={extraRefs.length >= maxExtra}
                                                        className="h-10 w-10 overflow-hidden rounded border border-white/10 opacity-80 hover:opacity-100 disabled:opacity-30"
                                                    >
                                                        <img src={getAssetUrl(u)} alt="" className="h-full w-full object-cover" />
                                                    </button>
                                                );
                                            })}
                                    </div>
                                ) : null}
                            </div>
                        ) : isSeedance15 ? (
                            <p className="shrink-0 text-[10px] text-gray-600">Seedance 1.5 仅支持单首帧。</p>
                        ) : null}

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <select
                                value={params.model}
                                onChange={(e) => onParamsPatch({ model: e.target.value })}
                                className="max-w-[11rem] rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-200"
                            >
                                {I2V_MODELS.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={params.duration}
                                onChange={(e) => onParamsPatch({ duration: Number(e.target.value) })}
                                className="rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-200"
                            >
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 15].map((d) => (
                                    <option key={d} value={d}>
                                        {d}s
                                    </option>
                                ))}
                            </select>
                            {isSeedance20 ? (
                                <select
                                    value={params.seedanceI2vMode}
                                    onChange={(e) => onParamsPatch({ seedanceI2vMode: e.target.value as SeedanceI2vMode })}
                                    className="rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-200"
                                >
                                    <option value="first_frame">首帧</option>
                                    <option value="first_last_frame">首尾帧</option>
                                    <option value="multimodal_ref">多图参考</option>
                                </select>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={onSubmitVideo}
                                disabled={videoBusy || !primaryRaw || frame.locked}
                                className="rounded-lg bg-emerald-600/90 px-2.5 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
                            >
                                {videoBusy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}
                                生成视频
                            </button>
                            {pending ? <span className="text-[10px] text-amber-400">处理中…</span> : null}
                        </div>
                        {completed.length > 0 ? (
                            <select
                                className="max-w-full shrink-0 rounded border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-gray-300"
                                value={frame.selected_video_id || ""}
                                onChange={(e) => handleSelectVideo(e.target.value)}
                            >
                                <option value="">选择成片</option>
                                {completed.map((t: any) => (
                                    <option key={t.id} value={t.id}>
                                        {t.id.slice(0, 8)}… {t.status}
                                    </option>
                                ))}
                            </select>
                        ) : null}
                    </div>

                    <div className="flex h-full min-h-0 w-[min(14rem,24vw)] shrink-0 flex-col gap-1.5 border-l border-white/10 pl-2 sm:w-[14rem]">
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
                    </div>
                </div>
            </div>

            <div className="px-2 pb-2 pt-0.5 border-t border-white/10 bg-black/25">
                <StoryboardFrameContextFields frameId={frame.id} />
            </div>
        </div>
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

    const [showScriptOverlay, setShowScriptOverlay] = useState(false);
    const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [insertIndex, setInsertIndex] = useState<number | null>(null);
    const [extractingFrameId, setExtractingFrameId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadTargetFrameId, setUploadTargetFrameId] = useState<string | null>(null);

    const [rowVideoPrompts, setRowVideoPrompts] = useState<Record<string, string>>({});
    const [extraRefByFrame, setExtraRefByFrame] = useState<Record<string, string[]>>({});
    const [videoBusyByFrame, setVideoBusyByFrame] = useState<Record<string, boolean>>({});

    const defaultI2v = currentProject?.model_settings?.i2v_model || "wan2.5-i2v-preview";
    const [params, setParams] = useState<RowVideoParams>({
        model: defaultI2v,
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
    });

    useEffect(() => {
        if (currentProject?.model_settings?.i2v_model) {
            setParams((p) => ({ ...p, model: currentProject.model_settings!.i2v_model! }));
        }
    }, [currentProject?.model_settings?.i2v_model]);

    const frames = currentProject?.frames || [];
    const tasks = currentProject?.video_tasks || [];

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
            const updatedProject = await api.analyzeToStoryboard(currentProject.id, text);
            const frameCount = updatedProject.frames?.length || 0;
            if (frameCount > 0) {
                updateProject(currentProject.id, updatedProject);
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
        const primaryRaw = frame.rendered_image_url || frame.image_url;
        if (!primaryRaw) {
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

        const extras = extraRefByFrame[frame.id] || [];
        const primaryDisplay = getAssetUrl(primaryRaw);
        let ordered: string[] = [primaryDisplay, ...extras];
        const seen = new Set<string>();
        ordered = ordered.filter((u) => {
            if (!u || seen.has(u)) return false;
            seen.add(u);
            return true;
        });

        const isSeedance20 = params.model === SEEDANCE_20_MODEL_ID;
        if (isSeedance20) {
            const m = params.seedanceI2vMode;
            const n = ordered.length;
            if (m === "first_frame" && n !== 1) {
                alert("首帧模式仅使用本镜首图；请清空附加参考。");
                return;
            }
            if (m === "first_last_frame" && n !== 2) {
                alert("首尾帧模式需要恰好 2 张图（本镜首帧 + 另一张尾帧）。");
                return;
            }
            if (m === "multimodal_ref" && (n < 1 || n > 9)) {
                alert("多图参考需要 1～9 张图。");
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

    return (
        <div className="flex flex-col h-full text-white overflow-hidden relative">
            <div className="flex-shrink-0 p-3 border-b border-white/10 flex items-center justify-between bg-black/20 gap-2">
                <h3 className="font-bold text-sm flex items-center gap-2 whitespace-nowrap">
                    <Layout size={16} className="text-primary shrink-0" />
                    <span className="hidden sm:inline">分镜与视频</span>
                </h3>
                <div className="flex items-center gap-2 flex-wrap justify-end">
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

            <div className="flex-1 overflow-x-auto overflow-y-auto p-3">
                <div className="flex flex-col gap-2 w-full min-w-0 max-w-full">
                    {frames.map((frame: any, index: number) => {
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
                                extraRefs={extraRefByFrame[frame.id] || []}
                                onAddExtraRef={(url) =>
                                    setExtraRefByFrame((prev) => ({
                                        ...prev,
                                        [frame.id]: [...(prev[frame.id] || []), url],
                                    }))
                                }
                                onRemoveExtraRef={(i) =>
                                    setExtraRefByFrame((prev) => {
                                        const list = [...(prev[frame.id] || [])];
                                        list.splice(i, 1);
                                        return { ...prev, [frame.id]: list };
                                    })
                                }
                                params={params}
                                onParamsPatch={(patch) => setParams((p) => ({ ...p, ...patch }))}
                                onSubmitVideo={() => submitVideoForFrame(frame)}
                                videoBusy={!!videoBusyByFrame[frame.id]}
                                tasksForFrame={tasksForFrame}
                            />
                        );
                    })}
                    {frames.length === 0 ? (
                        <div className="text-center text-gray-500 text-sm py-16">暂无分镜。请先写剧本并点击「生成分镜」。</div>
                    ) : null}
                </div>
            </div>

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

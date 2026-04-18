"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Layout, Check, X, Wand2, Eraser, Plus, Film } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api, API_URL, type VideoTask } from "@/lib/api";
import { getAssetUrl, getAssetUrlWithTimestamp } from "@/lib/utils";
import PromptBuilder, { type PromptSegment, type PromptBuilderRef } from "./PromptBuilder";
import type { VideoParams } from "@/store/projectStore";

export type R2VReferenceVideo = {
    url: string;
    thumbnail: string;
    title: string;
    assetName: string;
    type: string;
};

/** Motion ref + legacy video URLs for R2V cast slots (same source as former VideoCreator block). */
export function buildAvailableReferenceVideos(project: any): R2VReferenceVideo[] {
    if (!project) return [];
    const list: R2VReferenceVideo[] = [
        ...project.characters.flatMap((c: any) => {
            const variants: R2VReferenceVideo[] = [];
            if (c.full_body?.video_variants?.length) {
                variants.push(
                    ...c.full_body.video_variants.map((v: any) => ({
                        url: v.url,
                        thumbnail: c.full_body?.selected_image_id
                            ? (c.full_body.image_variants?.find((img: any) => img.id === c.full_body.selected_image_id)?.url ||
                                  c.full_body_image_url)
                            : c.full_body_image_url,
                        title: `${c.name} - Full Body Motion Reference`,
                        assetName: c.name,
                        type: "character_full_body",
                    }))
                );
            }
            if (c.head_shot?.video_variants?.length) {
                variants.push(
                    ...c.head_shot.video_variants.map((v: any) => ({
                        url: v.url,
                        thumbnail: c.head_shot?.selected_image_id
                            ? (c.head_shot.image_variants?.find((img: any) => img.id === c.head_shot.selected_image_id)?.url ||
                                  c.headshot_image_url)
                            : c.headshot_image_url,
                        title: `${c.name} - Headshot Motion Reference`,
                        assetName: c.name,
                        type: "character_headshot",
                    }))
                );
            }
            return variants;
        }),
        ...project.characters.flatMap((c: any) =>
            (c.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: v.image_url,
                title: `${c.name} - Video`,
                assetName: c.name,
                type: "character_legacy",
            }))
        ),
        ...project.scenes.flatMap((s: any) =>
            (s.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: v.image_url || s.image_url,
                title: `${s.name} - Video`,
                assetName: s.name,
                type: "scene",
            }))
        ),
        ...project.props.flatMap((p: any) =>
            (p.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: p.image_url,
                title: `${p.name} - Video`,
                assetName: p.name,
                type: "prop",
            }))
        ),
    ];
    return list.filter((v) => v.url && v.url !== "null" && v.url !== "undefined");
}

function normalizeMediaRefForApi(url: string): string {
    if (!url) return url;
    if (url.startsWith(`${API_URL}/files/`)) return url.replace(`${API_URL}/files/`, "");
    return url;
}

/** Match task-stored ref paths to asset library URLs (relative vs absolute). */
function urlsRoughlyEqual(a: string, b: string): boolean {
    const n = (s: string) =>
        s
            .trim()
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/^\/?(?:api-proxy\/)?files\//, "")
            .replace(/^\//, "");
    const na = n(a);
    const nb = n(b);
    if (!na || !nb) return false;
    return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

function getMotionDescription(params: VideoParams): string {
    const parts: string[] = [];
    if (params.cameraMovement && params.cameraMovement !== "none") {
        const cameraDescriptions: Record<string, string> = {
            pan_left_slow: "camera slowly pans to the left",
            pan_right_slow: "camera slowly pans to the right",
            pan_left_fast: "camera quickly pans to the left",
            pan_right_fast: "camera quickly pans to the right",
            tilt_up: "camera tilts up",
            tilt_down: "camera tilts down",
            zoom_in_slow: "camera slowly zooms in",
            zoom_out_slow: "camera slowly zooms out",
            zoom_in_fast: "camera dramatically zooms in",
            zoom_out_fast: "camera dramatically zooms out",
            dolly_in: "camera dolly in",
            dolly_out: "camera dolly out",
            orbit_left: "camera orbits to the left",
            orbit_right: "camera orbits to the right",
            crane_up: "camera cranes up",
            crane_down: "camera cranes down",
        };
        parts.push(cameraDescriptions[params.cameraMovement] || "");
    }
    if (params.subjectMotion && params.subjectMotion !== "still") {
        const subjectDescriptions: Record<string, string> = {
            subtle: "subtle movement",
            natural: "natural movement",
            dynamic: "dynamic action",
            fast: "fast-paced action",
        };
        parts.push(subjectDescriptions[params.subjectMotion] || "");
    }
    return parts.filter(Boolean).join(", ");
}

export type R2VStoryboardPanelProps = {
    onTaskCreated: (project: any) => void;
    params: VideoParams;
    onParamsChange?: (patch: Partial<VideoParams>) => void;
    /** Controlled: when both provided, frame selection syncs with parent (e.g. storyboard row). */
    selectedFrameId?: string | null;
    onSelectedFrameIdChange?: (id: string | null) => void;
    /** Tighter layout for StoryboardVideoWorkbench embed */
    compact?: boolean;
    /** Omit in-panel storyboard cards; parent owns frame selection. */
    hideFramePicker?: boolean;
    /** Fill parent height (no max-height cap); use with workbench fullscreen R2V. */
    fullBleed?: boolean;
    /** When queue Remix fires, parent bumps nonce and passes task to hydrate prompt + 卡司. */
    remixTask?: VideoTask | null;
    remixNonce?: number;
};

export default function R2VStoryboardPanel({
    onTaskCreated,
    params,
    onParamsChange,
    selectedFrameId: controlledFrameId,
    onSelectedFrameIdChange,
    compact = false,
    hideFramePicker = false,
    fullBleed = false,
    remixTask = null,
    remixNonce = 0,
}: R2VStoryboardPanelProps) {
    const currentProject = useProjectStore((s) => s.currentProject);

    const isControlled = onSelectedFrameIdChange != null;
    const [uncontrolledFrameId, setUncontrolledFrameId] = useState<string | null>(null);
    const effectiveFrameId = isControlled ? (controlledFrameId ?? null) : uncontrolledFrameId;
    const setEffectiveFrameId = useCallback(
        (id: string | null) => {
            if (isControlled) onSelectedFrameIdChange?.(id);
            else setUncontrolledFrameId(id);
        },
        [isControlled, onSelectedFrameIdChange]
    );

    const [castSlots, setCastSlots] = useState<{ url: string; name: string }[]>([]);
    const [segments, setSegments] = useState<PromptSegment[]>([{ type: "text", value: "", id: "init" }]);
    const promptBuilderRef = useRef<PromptBuilderRef>(null);
    const prompt = segments.map((s) => s.value).join(" ");

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [polishedPrompt, setPolishedPrompt] = useState<{ cn: string; en: string } | null>(null);
    const [isPolishing, setIsPolishing] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    const availableReferenceVideos = useMemo(
        () => buildAvailableReferenceVideos(currentProject),
        [currentProject]
    );

    const applyFrameToPrompt = useCallback((frame: any) => {
        let newPrompt = frame.action_description || frame.image_prompt || "";
        if (frame.dialogue) {
            newPrompt += ` Dialogue: ${frame.dialogue}`;
        }
        setSegments([{ type: "text", value: newPrompt, id: `frame-${frame.id}` }]);
    }, []);

    const handleR2VFrameSelect = (frame: any) => {
        setEffectiveFrameId(frame.id);
        applyFrameToPrompt(frame);
    };

    /** When parent (or picker) changes current frame, keep prompt in sync without re-applying same id. */
    const syncedFrameForPickerRef = useRef<string | null>(null);
    useEffect(() => {
        if (!effectiveFrameId || !currentProject?.frames?.length) {
            syncedFrameForPickerRef.current = null;
            return;
        }
        if (syncedFrameForPickerRef.current === effectiveFrameId) return;
        const frame = currentProject.frames.find((f: any) => f.id === effectiveFrameId);
        if (!frame) return;
        syncedFrameForPickerRef.current = effectiveFrameId;
        applyFrameToPrompt(frame);
    }, [effectiveFrameId, currentProject?.frames, applyFrameToPrompt]);

    /** Queue Remix: load prompt + slots; keep frame sync from overwriting remix text. */
    useEffect(() => {
        if (!remixTask || remixNonce < 1) return;

        const promptText = remixTask.prompt || "";
        setSegments([{ type: "text", value: promptText, id: `remix-${remixTask.id}-${remixNonce}` }]);
        setPolishedPrompt(null);

        const urls = remixTask.reference_video_urls || [];
        if (urls.length) {
            const nextSlots: { url: string; name: string }[] = [];
            for (let i = 0; i < 3; i++) {
                const u = urls[i];
                if (!u) {
                    nextSlots[i] = { url: "", name: "" };
                    continue;
                }
                const found = availableReferenceVideos.find((rv) => urlsRoughlyEqual(rv.url, u));
                nextSlots[i] = found ? { url: found.url, name: found.assetName } : { url: u, name: `参考${i + 1}` };
            }
            setCastSlots(nextSlots);
        }

        if (remixTask.frame_id) {
            syncedFrameForPickerRef.current = remixTask.frame_id;
        }
    }, [remixNonce, remixTask, availableReferenceVideos]);

    const handleCastSlotSelect = (slotIndex: number, video: { url: string; name: string }) => {
        setCastSlots((prev) => {
            const next = [...prev];
            while (next.length <= slotIndex) next.push({ url: "", name: "" });
            next[slotIndex] = video;
            return next;
        });
    };

    const handleClearCastSlot = (slotIndex: number) => {
        setCastSlots((prev) => {
            const next = [...prev];
            if (next[slotIndex]) next[slotIndex] = { url: "", name: "" };
            return next;
        });
    };

    const insertCharacter = (slotIndex: number) => {
        const slot = castSlots[slotIndex];
        if (!slot?.url) return;
        const video = availableReferenceVideos.find((v) => v.url === slot.url);
        const thumbnail = video?.thumbnail ? getAssetUrl(video.thumbnail) : undefined;
        promptBuilderRef.current?.insertCharacter(slotIndex, slot.name, thumbnail);
    };

    const handlePolish = useCallback(async (feedback: string = "") => {
        const draftPrompt = feedback ? polishedPrompt?.en || prompt : prompt;
        if (!draftPrompt) return;
        setIsPolishing(true);
        try {
            const scriptId = currentProject?.id || "";
            const slotInfo = castSlots
                .filter((slot) => slot.url)
                .map((slot) => ({ description: slot.name || "Unknown character" }));
            const res = await api.polishR2VPrompt(draftPrompt, slotInfo, feedback, scriptId);
            if (res.prompt_cn && res.prompt_en) {
                setPolishedPrompt({ cn: res.prompt_cn, en: res.prompt_en });
                setFeedbackText("");
            }
        } catch (error) {
            console.error("Polish failed", error);
            alert("AI 润色失败");
        } finally {
            setIsPolishing(false);
        }
    }, [castSlots, currentProject?.id, polishedPrompt?.en, prompt]);

    const handleSubmit = useCallback(async () => {
        const filledSlots = castSlots.filter((s) => s.url);
        if (filledSlots.length === 0) {
            alert("R2V 模式请至少填充一个角色槽位 (@Ref_A)");
            return;
        }
        if (!prompt?.trim() || !currentProject) return;

        setIsSubmitting(true);
        try {
            const motionDesc = getMotionDescription(params);
            const finalPrompt = motionDesc ? `${prompt}, ${motionDesc}` : prompt;

            const referenceVideos = castSlots.filter((s) => s.url).map((s) => normalizeMediaRefForApi(s.url));

            const optimisticTasks: VideoTask[] = [];
            for (let i = 0; i < params.batchSize; i++) {
                optimisticTasks.push({
                    id: `temp-${Date.now()}-r2v-${i}`,
                    project_id: currentProject.id,
                    image_url: "",
                    prompt: finalPrompt,
                    status: "pending",
                    duration: params.duration,
                    seed: params.seed,
                    resolution: params.resolution,
                    generate_audio: params.generateAudio,
                    audio_url: params.audioUrl,
                    prompt_extend: params.promptExtend,
                    negative_prompt: params.negativePrompt,
                    model: "wan2.6-r2v",
                    created_at: Date.now() / 1000,
                    generation_mode: "r2v",
                    reference_video_urls: referenceVideos,
                });
            }
            onTaskCreated({
                ...currentProject,
                video_tasks: [...(currentProject.video_tasks || []), ...optimisticTasks],
            });

            await api.createVideoTask(
                currentProject.id,
                "",
                finalPrompt,
                params.duration,
                params.seed,
                params.resolution,
                params.generateAudio,
                params.audioUrl,
                params.promptExtend,
                params.negativePrompt,
                params.batchSize,
                "wan2.6-r2v",
                effectiveFrameId || undefined,
                params.shotType,
                "r2v",
                referenceVideos,
                params.mode,
                params.sound,
                params.cfgScale,
                params.viduAudio,
                params.movementAmplitude
            );

            const updatedProject = await api.getProject(currentProject.id);
            onTaskCreated(updatedProject);
            setSubmitSuccess(true);
            setTimeout(() => setSubmitSuccess(false), 1500);
        } catch (error) {
            console.error("Failed to submit R2V task:", error);
            alert("提交失败");
            const updatedProject = await api.getProject(currentProject!.id);
            onTaskCreated(updatedProject);
        } finally {
            setIsSubmitting(false);
        }
    }, [castSlots, currentProject, effectiveFrameId, onTaskCreated, params, prompt]);

    useEffect(() => {
        const onDocKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "Enter") void handleSubmit();
        };
        window.addEventListener("keydown", onDocKey);
        return () => window.removeEventListener("keydown", onDocKey);
    }, [handleSubmit]);

    const pad = fullBleed ? "px-1 pt-3 pb-1" : compact ? "p-3" : "p-6";

    /** fullBleed：由外层工作台滚动，避免与父级双滚动条。 */
    const rootClass = fullBleed
        ? "flex flex-col gap-4 text-white w-full min-h-0"
        : `flex flex-col gap-4 text-white ${compact ? "max-h-[min(42vh,28rem)] overflow-y-auto" : ""}`;

    return (
        <div className={rootClass}>
            {!compact && !fullBleed && (
                <div className="flex items-center gap-2 text-purple-300/90">
                    <Film size={18} />
                    <span className="text-sm font-bold">角色驱动 (R2V)</span>
                    <span className="text-[10px] text-gray-500 font-mono bg-white/5 px-2 py-0.5 rounded">wan2.6-r2v</span>
                </div>
            )}

            {!hideFramePicker ? (
                <div className="space-y-2">
                    <label className={`font-medium text-gray-300 ${compact ? "text-xs" : "text-sm"}`}>选择分镜</label>
                    <div
                        className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${compact ? "max-h-[9rem]" : "max-h-[200px]"} overflow-y-auto custom-scrollbar pr-1`}
                    >
                        {currentProject?.frames?.length ? (
                            currentProject.frames.map((frame: any, frameIdx: number) => (
                                <button
                                    type="button"
                                    key={frame.id}
                                    onClick={() => handleR2VFrameSelect(frame)}
                                    className={`p-2 rounded-lg border text-left transition-all ${
                                        effectiveFrameId === frame.id
                                            ? "border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30"
                                            : "border-white/10 bg-black/20 hover:border-white/30"
                                    }`}
                                >
                                    <div className="flex items-start gap-2">
                                        <div className="w-14 h-9 rounded overflow-hidden shrink-0 bg-black/40">
                                            {frame.image_url || frame.rendered_image_url ? (
                                                <img
                                                    src={getAssetUrlWithTimestamp(
                                                        frame.rendered_image_url || frame.image_url,
                                                        frame.updated_at
                                                    )}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                    <Layout size={12} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] text-gray-500 font-mono tabular-nums">
                                                第 {frameIdx + 1} 镜
                                            </p>
                                            <p className="text-[11px] text-gray-300 line-clamp-2">
                                                {frame.action_description || frame.image_prompt || "暂无描述"}
                                            </p>
                                        </div>
                                        {effectiveFrameId === frame.id ? (
                                            <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center shrink-0">
                                                <Check size={10} className="text-white" />
                                            </div>
                                        ) : null}
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="col-span-2 flex flex-col items-center justify-center py-6 text-gray-500 gap-2">
                                <Layout size={22} className="opacity-20" />
                                <p className="text-xs">无分镜数据</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            <div className="space-y-2">
                <label className={`font-medium text-gray-300 ${compact ? "text-xs" : "text-sm"}`}>卡司槽位</label>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[0, 1, 2].map((slotIndex) => {
                        const slot = castSlots[slotIndex];
                        const video = slot?.url ? availableReferenceVideos.find((v) => v.url === slot.url) : null;
                        return (
                            <div
                                key={slotIndex}
                                className={`relative rounded-xl border-2 border-dashed transition-all ${
                                    slot?.url
                                        ? "border-purple-500 bg-purple-500/10"
                                        : "border-white/20 bg-black/20 hover:border-white/40"
                                }`}
                            >
                                <div className="absolute top-1.5 left-1.5 z-10">
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-600 text-white font-bold">
                                        角色{slotIndex + 1}
                                    </span>
                                </div>
                                {slot?.url ? (
                                    <div className="aspect-video relative pt-6">
                                        <img
                                            src={getAssetUrl(video?.thumbnail || "")}
                                            alt={slot.name}
                                            className="w-full h-full object-cover rounded-lg"
                                        />
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 rounded-b-lg">
                                            <p className="text-[10px] text-white font-medium truncate">{slot.name}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleClearCastSlot(slotIndex)}
                                            className="absolute top-7 right-1 p-1 bg-black/60 rounded-full text-white hover:bg-red-500"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="aspect-video flex flex-col items-center justify-center p-2 pt-7">
                                        <select
                                            className="w-full text-[10px] bg-black/40 border border-white/20 rounded-lg px-1 py-1 text-gray-300"
                                            value=""
                                            onChange={(e) => {
                                                const v = availableReferenceVideos.find((x) => x.url === e.target.value);
                                                if (v) handleCastSlotSelect(slotIndex, { url: v.url, name: v.assetName });
                                            }}
                                        >
                                            <option value="">参考视频…</option>
                                            {availableReferenceVideos.map((v, i) => (
                                                <option key={i} value={v.url}>
                                                    {v.assetName}
                                                </option>
                                            ))}
                                        </select>
                                        {slotIndex === 0 ? (
                                            <p className="text-[9px] text-amber-400 mt-1">至少填 1 槽</p>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                {availableReferenceVideos.length === 0 ? (
                    <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                        暂无可用的参考视频。请先在资产阶段为角色/场景生成 Motion Reference 视频。
                    </p>
                ) : null}
            </div>

            <div className="space-y-2">
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <label className={`font-medium text-gray-300 ${compact ? "text-xs" : "text-sm"}`}>提示词</label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handlePolish()}
                            disabled={isPolishing || !prompt}
                            className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50"
                        >
                            {isPolishing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                            AI 润色
                        </button>
                        <button
                            type="button"
                            onClick={() => setSegments([{ type: "text", value: "", id: "init" }])}
                            className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white/5"
                        >
                            <Eraser size={10} /> 清空
                        </button>
                    </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                    {[0, 1, 2].map((idx) => {
                        const slot = castSlots[idx];
                        const active = slot?.url;
                        const v = active ? availableReferenceVideos.find((x) => x.url === slot.url) : null;
                        return (
                            <button
                                type="button"
                                key={idx}
                                onClick={() => insertCharacter(idx)}
                                disabled={!active}
                                className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 ${
                                    active
                                        ? "border-purple-500/50 bg-purple-500/10 text-purple-300"
                                        : "border-white/10 text-gray-500 cursor-not-allowed"
                                }`}
                            >
                                {v?.thumbnail ? (
                                    <img src={getAssetUrl(v.thumbnail)} alt="" className="w-3 h-3 rounded-full object-cover" />
                                ) : null}
                                插入 {slot?.name || `角色${idx + 1}`}
                            </button>
                        );
                    })}
                </div>
                <PromptBuilder
                    ref={promptBuilderRef}
                    segments={segments}
                    onChange={setSegments}
                    placeholder={
                        "输入提示词…\n插入角色格式: [character1:名称]\n插入运镜格式: (camera: 运镜指令)"
                    }
                />
                <AnimatePresence>
                    {polishedPrompt ? (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-2 space-y-2"
                        >
                            <div className="flex justify-between items-start">
                                <span className="text-[10px] font-bold text-purple-400">AI 双语润色</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPolishedPrompt(null);
                                        setFeedbackText("");
                                    }}
                                    className="text-[10px] text-gray-400 hover:text-white"
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-300 whitespace-pre-wrap bg-black/20 p-2 rounded max-h-20 overflow-y-auto">
                                {polishedPrompt.cn}
                            </p>
                            <div className="flex justify-between gap-2">
                                <p className="text-[10px] text-gray-300 font-mono flex-1 whitespace-pre-wrap bg-black/20 p-2 rounded max-h-20 overflow-y-auto">
                                    {polishedPrompt.en}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSegments([{ type: "text", value: polishedPrompt.en, id: `polished-${Date.now()}` }]);
                                        setPolishedPrompt(null);
                                    }}
                                    className="text-[10px] shrink-0 text-white bg-purple-600 hover:bg-purple-500 px-2 py-1 rounded h-fit"
                                >
                                    应用英文
                                </button>
                            </div>
                            <div className="flex gap-2 pt-1 border-t border-purple-500/20">
                                <input
                                    type="text"
                                    value={feedbackText}
                                    onChange={(e) => setFeedbackText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && feedbackText.trim() && !isPolishing) {
                                            void handlePolish(feedbackText.trim());
                                        }
                                    }}
                                    placeholder="修改意见…"
                                    className="flex-1 text-[10px] bg-black/30 border border-purple-500/20 rounded px-2 py-1 text-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handlePolish(feedbackText.trim())}
                                    disabled={isPolishing || !feedbackText.trim()}
                                    className="text-[10px] text-white bg-purple-600 px-2 py-1 rounded disabled:opacity-50"
                                >
                                    再润色
                                </button>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>

            {(compact || fullBleed) && onParamsChange ? (
                <div
                    className={`flex flex-wrap items-center gap-2 text-gray-400 ${
                        fullBleed ? "text-xs sm:text-sm" : "text-[10px]"
                    }`}
                >
                    <span>时长</span>
                    <select
                        value={params.duration}
                        onChange={(e) => onParamsChange({ duration: Number(e.target.value) })}
                        className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-gray-200"
                    >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                            <option key={d} value={d}>
                                {d}s
                            </option>
                        ))}
                    </select>
                    <span>批量</span>
                    <select
                        value={params.batchSize}
                        onChange={(e) => onParamsChange({ batchSize: Number(e.target.value) })}
                        className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-gray-200"
                    >
                        {[1, 2, 3, 4].map((b) => (
                            <option key={b} value={b}>
                                ×{b}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}

            <div
                className={`border-t border-white/10 pt-3 ${pad} ${
                    fullBleed
                        ? "sticky bottom-0 z-10 mt-4 -mx-1 bg-gradient-to-t from-[#080808] from-70% to-transparent pb-2 pt-4 px-1"
                        : ""
                }`}
            >
                <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!prompt?.trim() || isSubmitting}
                    className={`w-full py-2.5 rounded-xl font-bold ${fullBleed ? "text-base py-3" : "text-sm"} flex items-center justify-center gap-2 transition-all ${
                        submitSuccess ? "bg-green-600 text-white" : "bg-purple-600 hover:bg-purple-500 text-white"
                    } disabled:opacity-50`}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="animate-spin" size={16} /> 提交中…
                        </>
                    ) : submitSuccess ? (
                        <>已加入队列</>
                    ) : (
                        <>
                            <Plus size={16} /> R2V 加入生成队列 (Ctrl+Enter)
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

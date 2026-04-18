"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Upload, X, Wand2, Plus, ChevronDown, ChevronUp, Loader2, Layout,
    Video,
    Eraser,
    Check,
    Image as ImageIcon,
    Users,
    Film
} from "lucide-react";





import { useProjectStore } from "@/store/projectStore";
import { api, API_URL, VideoTask } from "@/lib/api";
import { getAssetUrl, getAssetUrlWithTimestamp } from "@/lib/utils";
import PromptBuilder, { PromptSegment, PromptBuilderRef } from "./PromptBuilder";
import R2VStoryboardPanel from "./R2VStoryboardPanel";
import { SEEDANCE_20_MODEL_ID, type VideoParams } from "@/store/projectStore";

interface VideoCreatorProps {
    onTaskCreated: (project: any) => void;
    remixData: Partial<VideoTask> | null;
    onRemixClear: () => void;
    params: VideoParams;
    onParamsChange: (params: Partial<VideoParams>) => void;
}

export default function VideoCreator({ onTaskCreated, remixData, onRemixClear, params, onParamsChange }: VideoCreatorProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    // Helper function to generate motion description text
    const getMotionDescription = () => {
        const parts: string[] = [];

        if (params.cameraMovement && params.cameraMovement !== 'none') {
            const cameraDescriptions: Record<string, string> = {
                'pan_left_slow': 'camera slowly pans to the left',
                'pan_right_slow': 'camera slowly pans to the right',
                'pan_left_fast': 'camera quickly pans to the left',
                'pan_right_fast': 'camera quickly pans to the right',
                'tilt_up': 'camera tilts up',
                'tilt_down': 'camera tilts down',
                'zoom_in_slow': 'camera slowly zooms in',
                'zoom_out_slow': 'camera slowly zooms out',
                'zoom_in_fast': 'camera dramatically zooms in',
                'zoom_out_fast': 'camera dramatically zooms out',
                'dolly_in': 'camera dolly in',
                'dolly_out': 'camera dolly out',
                'orbit_left': 'camera orbits to the left',
                'orbit_right': 'camera orbits to the right',
                'crane_up': 'camera cranes up',
                'crane_down': 'camera cranes down'
            };
            parts.push(cameraDescriptions[params.cameraMovement] || '');
        }

        if (params.subjectMotion && params.subjectMotion !== 'still') {
            const subjectDescriptions: Record<string, string> = {
                'subtle': 'subtle movement',
                'natural': 'natural movement',
                'dynamic': 'dynamic action',
                'fast': 'fast-paced action'
            };
            parts.push(subjectDescriptions[params.subjectMotion] || '');
        }

        return parts.filter(p => p).join(', ');
    };

    const [uploadingPaths, setUploadingPaths] = useState<Record<string, string>>({}); // Map blobUrl -> serverUrl
    const [activeTab, setActiveTab] = useState<"storyboard" | "upload">("storyboard");

    const [generationMode, setGenerationMode] = useState<"i2v" | "r2v">("i2v"); // Local mode state
    const [extractingFrameId, setExtractingFrameId] = useState<string | null>(null);

    // Sync from parent params
    useEffect(() => {
        if (params.generationMode) {
            setGenerationMode(params.generationMode as "i2v" | "r2v");
        }
    }, [params.generationMode]);

    const refUrls = params.referenceImageUrls ?? [];
    const maxRefImages = () =>
        params.model === SEEDANCE_20_MODEL_ID
            ? params.seedanceI2vMode === "multimodal_ref"
                ? 9
                : params.seedanceI2vMode === "first_last_frame"
                    ? 2
                    : 1
            : 50;

    const setRefUrls = (next: string[]) => {
        onParamsChange({ referenceImageUrls: next });
    };

    const handleExtractLastFrame = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject?.frames) return;

        const frameIndex = currentProject.frames.findIndex((f: any) => f.id === frameId);
        if (frameIndex <= 0) return;

        const prevFrame = currentProject.frames[frameIndex - 1];
        if (!prevFrame.selected_video_id) return;

        const prevVideo = currentProject.video_tasks?.find(
            (t: any) => t.id === prevFrame.selected_video_id && t.status === "completed"
        );
        if (!prevVideo) return;

        setExtractingFrameId(frameId);
        try {
            const updatedProject = await api.extractLastFrame(currentProject.id, frameId, prevVideo.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to extract last frame:", error);
            alert(error?.response?.data?.detail || "Failed to extract last frame");
        } finally {
            setExtractingFrameId(null);
        }
    };

    const handleFrameSelect = (frame: any) => {
        const url = frame.rendered_image_url || frame.image_url;
        if (!url) return;

        const isSeedance = params.model === SEEDANCE_20_MODEL_ID && generationMode === "i2v";

        if (!isSeedance) {
            if (refUrls.includes(url)) {
                setRefUrls([]);
                return;
            }
            setRefUrls([url]);
        } else {
            const mode = params.seedanceI2vMode;
            if (mode === "first_frame") {
                if (refUrls[0] === url && refUrls.length === 1) setRefUrls([]);
                else setRefUrls([url]);
            } else if (mode === "first_last_frame") {
                if (refUrls.includes(url)) {
                    setRefUrls(refUrls.filter((u) => u !== url));
                } else if (refUrls.length < 2) {
                    setRefUrls([...refUrls, url]);
                } else {
                    setRefUrls([refUrls[0], url]);
                }
            } else {
                if (refUrls.includes(url)) {
                    setRefUrls(refUrls.filter((u) => u !== url));
                } else if (refUrls.length >= 9) {
                    alert("最多选择 9 张参考图");
                    return;
                } else {
                    setRefUrls([...refUrls, url]);
                }
            }
        }

        let newPrompt = frame.image_prompt || frame.action_description || "";
        if (frame.dialogue) {
            newPrompt += ` . Dialogue: ${frame.dialogue}`;
        }
        setSegments([{ type: "text", value: newPrompt, id: "init" }]);
    };
    const [segments, setSegments] = useState<PromptSegment[]>([{ type: "text", value: "", id: "init" }]);
    const promptBuilderRef = useRef<PromptBuilderRef>(null);

    // Computed prompt for API
    const prompt = segments.map(s => s.value).join(" ");

    // negativePrompt moved to params
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [showCameraDropdown, setShowCameraDropdown] = useState(false);
    const [polishedPrompt, setPolishedPrompt] = useState<{ cn: string; en: string } | null>(null);
    const [isPolishing, setIsPolishing] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    const handlePolish = async (feedback: string = "") => {
        const draftPrompt = feedback ? (polishedPrompt?.en || prompt) : prompt;
        if (!draftPrompt) return;
        if (generationMode === "r2v") return;
        setIsPolishing(true);
        try {
            const scriptId = currentProject?.id || "";
            const res = await api.polishVideoPrompt(draftPrompt, feedback, scriptId);
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
    };


    // Handle Remix Data
    useEffect(() => {
        if (remixData) {
            const extra = remixData.reference_image_urls ?? [];
            const urls = [remixData.image_url, ...extra].filter(Boolean) as string[];
            const patch: Partial<VideoParams> = {};
            if (urls.length) patch.referenceImageUrls = urls;
            if (remixData.seedance_i2v_mode)
                patch.seedanceI2vMode = remixData.seedance_i2v_mode as VideoParams["seedanceI2vMode"];
            if (Object.keys(patch).length) onParamsChange(patch);
            if (remixData.prompt) setSegments([{ type: "text", value: remixData.prompt, id: "remix" }]);
            onRemixClear();
        }
    }, [remixData, onRemixClear, onParamsChange]);

    const handleImageSelect = (files: FileList | null) => {
        if (!files) return;

        const newImages: string[] = [];

        Array.from(files).forEach(async (file) => {
            const blobUrl = URL.createObjectURL(file);
            newImages.push(blobUrl);

            try {
                const res = await api.uploadFile(file);
                setUploadingPaths((prev) => ({ ...prev, [blobUrl]: res.url }));
            } catch (error) {
                console.error("Upload failed", error);
            }
        });

        const max = maxRefImages();
        onParamsChange({
            referenceImageUrls: [...refUrls, ...newImages].slice(0, max),
        });
    };

    const handleAssetSelect = (url: string) => {
        if (refUrls.includes(url)) return;
        const max = maxRefImages();
        if (refUrls.length >= max) {
            if (params.model === SEEDANCE_20_MODEL_ID) {
                alert(
                    params.seedanceI2vMode === "multimodal_ref"
                        ? "已达到参考图数量上限"
                        : "当前模式参考图数量已满"
                );
            }
            return;
        }
        setRefUrls([...refUrls, url]);
    };

    const removeImage = (index: number) => {
        setRefUrls(refUrls.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (generationMode === "r2v") return;
        if (generationMode === "i2v") {
            if (!prompt || !currentProject) return;
            for (const img of refUrls) {
                if (img.startsWith("blob:") && !uploadingPaths[img]) {
                    alert("图片仍在上传中，请稍候再试");
                    return;
                }
            }
            if (params.model === SEEDANCE_20_MODEL_ID) {
                const m = params.seedanceI2vMode;
                const n = refUrls.length;
                if (m === "first_frame" && n !== 1) {
                    alert("首帧模式需要恰好 1 张参考图");
                    return;
                }
                if (m === "first_last_frame" && n !== 2) {
                    alert("首尾帧模式需要恰好 2 张图（顺序：首帧 → 尾帧）");
                    return;
                }
                if (m === "multimodal_ref" && (n < 1 || n > 9)) {
                    alert("多模态参考需要 1～9 张参考图");
                    return;
                }
            } else if (refUrls.length === 0) {
                return;
            }
        }

        if (!currentProject) return;

        setIsSubmitting(true);
        try {
            const motionDesc = getMotionDescription();
            const finalPrompt = motionDesc ? `${prompt}, ${motionDesc}` : prompt;

            const isSeedanceI2v =
                generationMode === "i2v" && params.model === SEEDANCE_20_MODEL_ID && refUrls.length >= 1;

            if (isSeedanceI2v) {
                const normalized: string[] = [];
                for (const img of refUrls) {
                    let u = img;
                    if (img.startsWith("blob:")) {
                        u = uploadingPaths[img]!;
                    } else if (img.startsWith(`${API_URL}/files/`)) {
                        u = img.replace(`${API_URL}/files/`, "");
                    }
                    normalized.push(u);
                }
                const first = normalized[0];
                const rest = normalized.slice(1);
                const frame0 = refUrls[0];
                const frameMatch = currentProject?.frames?.find(
                    (f: any) =>
                        (f.rendered_image_url || f.image_url) === frame0 ||
                        f.image_url === frame0 ||
                        `${API_URL}/files/${f.image_url}` === frame0
                );
                const frameId = frameMatch?.id;

                const optimisticTasks: VideoTask[] = [];
                for (let i = 0; i < params.batchSize; i++) {
                    optimisticTasks.push({
                        id: `temp-${Date.now()}-sd-${i}`,
                        project_id: currentProject!.id,
                        image_url: first,
                        prompt: finalPrompt,
                        status: "pending",
                        duration: params.duration,
                        seed: params.seed,
                        resolution: params.resolution,
                        generate_audio: params.generateAudio,
                        audio_url: params.audioUrl,
                        prompt_extend: params.promptExtend,
                        negative_prompt: params.negativePrompt,
                        model: params.model,
                        created_at: Date.now() / 1000,
                        generation_mode: generationMode,
                        reference_image_urls: rest,
                        seedance_i2v_mode: params.seedanceI2vMode,
                    });
                }
                onTaskCreated({
                    ...currentProject!,
                    video_tasks: [...(currentProject!.video_tasks || []), ...optimisticTasks],
                });
                for (let b = 0; b < params.batchSize; b++) {
                    await api.createVideoTask(
                        currentProject!.id,
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
                        frameId,
                        params.shotType,
                        generationMode,
                        [],
                        params.mode,
                        params.sound,
                        params.cfgScale,
                        params.viduAudio,
                        params.movementAmplitude,
                        rest.length ? rest : undefined,
                        params.seedanceI2vMode
                    );
                }
                const updatedProject = await api.getProject(currentProject!.id);
                onTaskCreated(updatedProject);
                setSubmitSuccess(true);
                setTimeout(() => setSubmitSuccess(false), 1500);
                return;
            }

            const optimisticTasks: VideoTask[] = [];

            const itemsToProcess = refUrls;

            itemsToProcess.forEach((img, idx) => {
                let displayUrl = img;
                if (img && img.startsWith("blob:")) {
                    displayUrl = uploadingPaths[img] || img;
                } else if (img && !img.startsWith("http")) {
                    displayUrl = img;
                }

                for (let i = 0; i < params.batchSize; i++) {
                    optimisticTasks.push({
                        id: `temp-${Date.now()}-${idx}-${i}`,
                        project_id: currentProject.id,
                        image_url: displayUrl,
                        prompt: finalPrompt,
                        status: "pending",
                        video_url: undefined,
                        duration: params.duration,
                        seed: params.seed,
                        resolution: params.resolution,
                        generate_audio: params.generateAudio,
                        audio_url: params.audioUrl,
                        prompt_extend: params.promptExtend,
                        negative_prompt: params.negativePrompt,
                        model: params.model,
                        created_at: Date.now() / 1000,
                        generation_mode: "i2v",
                        reference_video_urls: [],
                    });
                }
            });

            // Immediately update UI with optimistic tasks
            const optimisticProject = {
                ...currentProject,
                video_tasks: [...(currentProject.video_tasks || []), ...optimisticTasks]
            };
            onTaskCreated(optimisticProject);

            // Batch submit for all images
            for (const img of itemsToProcess) {
                let finalImageUrl = img;
                if (img && img.startsWith("blob:")) {
                    if (uploadingPaths[img]) {
                        finalImageUrl = uploadingPaths[img];
                    } else {
                        console.warn("Image upload pending for", img);
                        continue;
                    }
                } else if (img && img.startsWith(`${API_URL}/files/`)) {
                    finalImageUrl = img.replace(`${API_URL}/files/`, "");
                }

                const frame = currentProject?.frames?.find((f: any) =>
                    (f.rendered_image_url || f.image_url) === img ||
                    f.image_url === img ||
                    `${API_URL}/files/${f.image_url}` === img
                );
                const frameId = frame ? frame.id : undefined;

                await api.createVideoTask(
                    currentProject.id,
                    finalImageUrl,
                    finalPrompt,
                    params.duration,
                    params.seed,
                    params.resolution,
                    params.generateAudio,
                    params.audioUrl,
                    params.promptExtend,
                    params.negativePrompt,
                    params.batchSize,
                    params.model,
                    frameId,
                    params.shotType,
                    "i2v",
                    [],
                    // Kling params
                    params.mode,
                    params.sound,
                    params.cfgScale,
                    // Vidu params
                    params.viduAudio,
                    params.movementAmplitude
                );
            }

            // Refresh with actual data from server
            const updatedProject = await api.getProject(currentProject.id);
            onTaskCreated(updatedProject);

            // Success feedback
            setSubmitSuccess(true);
            setTimeout(() => setSubmitSuccess(false), 1500);

            // Clear selection after successful submit
            // setSelectedImages([]); // Keep selection for iterative generation
        } catch (error) {
            console.error("Failed to submit task:", error);
            alert("提交失败");
            // Refresh to remove optimistic updates
            const updatedProject = await api.getProject(currentProject.id);
            onTaskCreated(updatedProject);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "Enter" && generationMode === "i2v") {
                handleSubmit();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [refUrls, prompt, currentProject, params, uploadingPaths, generationMode]);

    // Available assets for drag/drop or selection
    const availableAssets = currentProject ? [
        ...currentProject.characters.map((c: any) => ({
            url: getAssetUrl(c.image_url),
            title: c.name
        })),
        ...currentProject.scenes.map((s: any) => ({
            url: getAssetUrl(s.image_url),
            title: s.name
        }))
    ].filter(a => a.url) : [];

    return (
        <div className="h-full flex flex-col relative min-h-0">
            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar min-h-0">
                <h2 className="text-2xl font-display font-bold text-white mb-6 flex items-center gap-3">
                    <div className="w-2 h-8 bg-primary rounded-full" />
                    动态演译
                    <span className="text-xs font-mono text-gray-500 bg-white/5 px-2 py-1 rounded">Motion</span>
                </h2>

                <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full pb-8">
                    {/* Generation Mode Switcher */}
                    <div className="flex items-center justify-center">
                        <div className="flex bg-black/40 rounded-xl p-1.5 gap-1 border border-white/10">
                            <button
                                onClick={() => {
                                    setGenerationMode("i2v");
                                    onParamsChange({ generationMode: "i2v" });
                                }}
                                className={`px-5 py-2.5 text-sm rounded-lg flex items-center gap-2 transition-all font-medium ${generationMode === "i2v"
                                    ? "bg-primary text-white shadow-lg"
                                    : "text-gray-400 hover:text-white hover:bg-white/5"
                                    }`}
                            >
                                <ImageIcon size={16} />
                                🖼️ 首帧驱动 (I2V)
                            </button>
                            <button
                                onClick={() => {
                                    setGenerationMode("r2v");
                                    onParamsChange({
                                        generationMode: "r2v",
                                        model: "wan2.6-i2v" // Force Wan 2.6 when switching to R2V
                                    });
                                }}
                                className={`px-5 py-2.5 text-sm rounded-lg flex items-center gap-2 transition-all font-medium ${generationMode === "r2v"
                                    ? "bg-purple-600 text-white shadow-lg"
                                    : "text-gray-400 hover:text-white hover:bg-white/5"
                                    }`}
                            >
                                <Film size={16} />
                                🎬 角色驱动 (R2V)
                            </button>
                        </div>
                    </div>
                    {/* === I2V MODE: Source Selector === */}
                    {generationMode === 'i2v' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-300">首帧图片 (First Frame)</label>
                                <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                                    <button
                                        onClick={() => setActiveTab("storyboard")}
                                        className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-2 transition-all ${activeTab === "storyboard"
                                            ? "bg-primary text-white shadow-sm"
                                            : "text-gray-400 hover:text-white hover:bg-white/5"
                                            }`}
                                    >
                                        <Layout size={14} /> Storyboard
                                    </button>
                                    <button
                                        onClick={() => setActiveTab("upload")}
                                        className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-2 transition-all ${activeTab === "upload"
                                            ? "bg-primary text-white shadow-sm"
                                            : "text-gray-400 hover:text-white hover:bg-white/5"
                                            }`}
                                    >
                                        <Upload size={14} /> Upload
                                    </button>
                                </div>
                            </div>

                            {/* Tab Content */}
                            <div className="bg-black/20 border border-white/10 rounded-xl p-4 min-h-[200px]">
                                {activeTab === "storyboard" ? (
                                    <div className="space-y-4">
                                        {currentProject?.frames && currentProject.frames.length > 0 ? (() => {
                                            const completedVideoIds = new Set(
                                                currentProject.video_tasks
                                                    ?.filter((t: any) => t.status === "completed")
                                                    .map((t: any) => t.id) ?? []
                                            );
                                            return (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 p-2">
                                                {currentProject.frames.map((frame: any, index: number) => {
                                                    const prevFrame = index > 0 ? currentProject.frames![index - 1] : null;
                                                    const prevVideoCompleted = prevFrame?.selected_video_id && completedVideoIds.has(prevFrame.selected_video_id);
                                                    const isExtracting = extractingFrameId === frame.id;
                                                    const hasExtracted = !!frame.rendered_image_url;

                                                    return (
                                                    <div
                                                        key={frame.id}
                                                        onClick={() => handleFrameSelect(frame)}
                                                        className={`group relative aspect-video rounded-lg overflow-hidden border cursor-pointer transition-all ${refUrls.includes(frame.rendered_image_url || frame.image_url)
                                                            ? "border-primary ring-2 ring-primary/50"
                                                            : "border-white/10 hover:border-white/30"
                                                            }`}
                                                    >
                                                        {(frame.rendered_image_url || frame.image_url) ? (
                                                            <img
                                                                src={getAssetUrlWithTimestamp(frame.rendered_image_url || frame.image_url, frame.updated_at)}
                                                                alt={`Frame ${frame.id}`}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-full bg-white/5 flex items-center justify-center text-xs text-gray-500">
                                                                No Image
                                                            </div>
                                                        )}
                                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <span className="text-xs text-white font-bold">Select</span>
                                                        </div>
                                                        {/* Frame Number Badge */}
                                                        <div className="absolute top-1 left-1 bg-black/60 px-1.5 rounded text-[10px] text-gray-300 backdrop-blur-sm">
                                                            #{frame.id.slice(0, 4)}
                                                        </div>
                                                        {/* Extract Last Frame Button */}
                                                        {prevVideoCompleted && (
                                                            <button
                                                                onClick={(e) => handleExtractLastFrame(frame.id, e)}
                                                                disabled={isExtracting}
                                                                className={`absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium backdrop-blur-sm transition-colors ${
                                                                    hasExtracted
                                                                        ? "bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-purple-500/20 hover:text-purple-300 hover:border-purple-500/30"
                                                                        : "bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/40"
                                                                } disabled:opacity-50`}
                                                                title={hasExtracted ? "Re-extract previous video's last frame" : "Use previous video's last frame as input"}
                                                            >
                                                                {isExtracting ? (
                                                                    <Loader2 size={10} className="animate-spin" />
                                                                ) : hasExtracted ? (
                                                                    <><Check size={10} /> Applied</>
                                                                ) : (
                                                                    <><Film size={10} /> Prev End Frame</>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                            );
                                        })() : (
                                            <div className="flex flex-col items-center justify-center h-[200px] text-gray-500 gap-2">
                                                <Layout size={32} className="opacity-20" />
                                                <p className="text-xs">No storyboard frames found.</p>
                                            </div>
                                        )}

                                        {/* Selected Preview (Storyboard Mode) */}
                                        {refUrls.length > 0 && (
                                            <div className="pt-4 border-t border-white/10">
                                                <p className="text-xs text-gray-500 mb-2">Selected for Generation:</p>
                                                <div className="flex gap-2 flex-wrap">
                                                    {refUrls.map((img, idx) => {
                                                        // Find frame to get updated_at for cache busting
                                                        const frame = currentProject?.frames?.find((f: any) => (f.rendered_image_url || f.image_url) === img);
                                                        const timestamp = frame?.updated_at || 0;
                                                        return (
                                                            <div key={idx} className="relative w-24 aspect-video rounded-lg overflow-hidden border border-white/20">
                                                                <img
                                                                    src={timestamp ? getAssetUrlWithTimestamp(img, timestamp) : getAssetUrl(img)}
                                                                    alt="Selected"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <button
                                                                    onClick={() => removeImage(idx)}
                                                                    className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-full text-white hover:bg-red-500"
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Upload Mode Content */
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-3 gap-4">
                                            {refUrls.map((img, idx) => (
                                                <div key={idx} className="relative aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/10 group">
                                                    <img
                                                        src={getAssetUrl(img)}
                                                        alt={`Input ${idx}`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                    <button
                                                        onClick={() => removeImage(idx)}
                                                        className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                    {img.startsWith("blob:") && !uploadingPaths[img] && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                            <Loader2 className="animate-spin text-white" size={20} />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {/* Add Button */}
                                            <div
                                                onClick={() => document.getElementById('image-upload')?.click()}
                                                className="aspect-video border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center bg-white/5 hover:bg-white/10 transition-colors cursor-pointer relative min-h-[100px]"
                                            >
                                                <input
                                                    id="image-upload"
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    className="hidden"
                                                    onChange={(e) => handleImageSelect(e.target.files)}
                                                />
                                                <Plus className="text-gray-400 mb-2" size={24} />
                                                <p className="text-gray-400 text-xs font-medium">Add Image</p>
                                            </div>
                                        </div>

                                        {/* Quick Select from Assets (Only in Upload Mode) */}
                                        {availableAssets.length > 0 && (
                                            <div className="mt-4 pt-4 border-t border-white/10">
                                                <p className="text-xs text-gray-500 mb-2">Quick Select from Assets:</p>
                                                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                                    {availableAssets.slice(0, 10).map((asset, i) => (
                                                        <div
                                                            key={i}
                                                            onClick={() => handleAssetSelect(asset.url)}
                                                            className="w-16 h-16 relative rounded-lg overflow-hidden flex-shrink-0 border border-white/10 hover:border-primary cursor-pointer"
                                                        >
                                                            <img src={asset.url} alt={asset.title} className="w-full h-full object-cover" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {generationMode === "r2v" && (
                        <R2VStoryboardPanel
                            onTaskCreated={onTaskCreated}
                            params={params}
                            onParamsChange={onParamsChange}
                        />
                    )}

                    {/* 2. Prompt Input (I2V only; R2V uses R2VStoryboardPanel) */}
                    {generationMode === "i2v" && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-medium text-gray-300">提示词 (Prompt)</label>
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <button
                                        onClick={() => promptBuilderRef.current?.insertCamera()}
                                        className="text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors text-gray-400 hover:text-white hover:bg-white/5"
                                    >
                                        <Video size={12} /> 运镜
                                    </button>
                                </div>
                                <button
                                    onClick={() => handlePolish()}
                                    disabled={isPolishing || !prompt}
                                    className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50"
                                >
                                    {isPolishing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                                    AI 润色
                                </button>
                                <button
                                    onClick={() => setSegments([{ type: "text", value: "", id: "init" }])}
                                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                                    title="Clear Prompt"
                                >
                                    <Eraser size={12} /> 清空
                                </button>
                            </div>
                        </div>

                        <div className="relative">
                            <PromptBuilder
                                ref={promptBuilderRef}
                                segments={segments}
                                onChange={setSegments}
                                placeholder={
                                    "输入提示词，描述画面内容...\n插入运镜格式: (camera: 运镜指令)"
                                }
                            />
                        </div>

                        {/* Polished Result Display - Bilingual */}
                        <AnimatePresence>
                            {polishedPrompt && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 mt-2 space-y-3"
                                >
                                    <div className="flex justify-between items-start">
                                        <span className="text-xs font-bold text-purple-400 flex items-center gap-1">
                                            <Wand2 size={12} /> AI 双语润色
                                        </span>
                                        <button
                                            onClick={() => { setPolishedPrompt(null); setFeedbackText(""); }}
                                            className="text-[10px] text-gray-400 hover:text-white"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    {/* Chinese Prompt */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">中文 (预览)</span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(polishedPrompt.cn);
                                                    alert("中文提示词已复制");
                                                }}
                                                className="text-[10px] text-gray-400 hover:text-white bg-black/20 px-2 py-0.5 rounded"
                                            >
                                                复制
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-black/20 p-2 rounded">
                                            {polishedPrompt.cn}
                                        </p>
                                    </div>

                                    {/* English Prompt */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">English (生成用)</span>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(polishedPrompt.en);
                                                        alert("English prompt copied");
                                                    }}
                                                    className="text-[10px] text-gray-400 hover:text-white bg-black/20 px-2 py-0.5 rounded"
                                                >
                                                    Copy
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSegments([{ type: "text", value: polishedPrompt.en, id: `polished-${Date.now()}` }]);
                                                        setPolishedPrompt(null);
                                                    }}
                                                    className="text-[10px] text-white bg-purple-600 hover:bg-purple-500 px-2 py-0.5 rounded font-bold"
                                                >
                                                    应用
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-black/20 p-2 rounded font-mono">
                                            {polishedPrompt.en}
                                        </p>
                                    </div>

                                    {/* Feedback for iterative refinement */}
                                    <div className="space-y-2 pt-2 border-t border-purple-500/20">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={feedbackText}
                                                onChange={(e) => setFeedbackText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && feedbackText.trim() && !isPolishing) {
                                                        handlePolish(feedbackText.trim());
                                                    }
                                                }}
                                                placeholder="哪里不满意？描述你的修改意见..."
                                                className="flex-1 text-xs bg-black/30 border border-purple-500/20 rounded px-2 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                                            />
                                            <button
                                                onClick={() => handlePolish(feedbackText.trim())}
                                                disabled={isPolishing || !feedbackText.trim()}
                                                className="text-xs text-white bg-purple-600 hover:bg-purple-500 px-3 py-1.5 rounded font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                            >
                                                {isPolishing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                                                再润色
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    )}
                </div>
            </div >

            {/* 4. Fixed Action Bar (I2V only) */}
            {generationMode === "i2v" && (
            < div className="p-6 border-t border-white/10 bg-black/40 backdrop-blur-md z-10" >
                <div className="max-w-4xl mx-auto w-full">
                    <button
                        onClick={handleSubmit}
                        disabled={(!prompt || isSubmitting) || refUrls.length === 0}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.99] ${submitSuccess
                            ? "bg-green-500 text-white"
                            : "bg-primary hover:bg-primary/90 text-white"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="animate-spin" /> 提交中...
                            </>
                        ) : submitSuccess ? (
                            <>
                                <Plus /> 已加入队列
                            </>
                        ) : (
                            <>
                                <Plus /> 加入生成队列 (Ctrl+Enter)
                            </>
                        )}
                    </button>
                    <div className="flex justify-center mt-3">
                        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                            <input type="checkbox" className="rounded bg-white/10 border-white/20" />
                            提交后清空内容
                        </label>
                    </div>
                </div>
            </div >
            )}
        </div >
    );
}

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Wand2, Sparkles } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";

/** Action / Dialogue 左列上下对半 + 首帧提示词与 Auto-Compose / Polish */
export default function StoryboardFirstFramePromptColumn({
    frameId,
    className = "",
    hideFirstFrameSection = false,
}: {
    frameId: string;
    className?: string;
    hideFirstFrameSection?: boolean;
}) {
    const currentProject = useProjectStore((s) => s.currentProject);
    const updateProject = useProjectStore((s) => s.updateProject);
    const frame = currentProject?.frames?.find((f: any) => f.id === frameId) ?? null;

    const [polishedPrompt, setPolishedPrompt] = useState<{ cn: string; en: string } | null>(null);
    const [isPolishing, setIsPolishing] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    if (!currentProject || !frame) return null;

    const updateFrame = async (data: any) => {
        const updatedFrames = currentProject.frames.map((f: any) => (f.id === frameId ? { ...f, ...data } : f));
        updateProject(currentProject.id, { frames: updatedFrames });
        try {
            await api.updateFrame(currentProject.id, frameId, data);
        } catch (error) {
            console.error("Failed to sync frame to backend:", error);
        }
    };

    const handleComposePrompt = () => {
        const scene = currentProject.scenes?.find((s: any) => s.id === frame.scene_id);
        const characters = currentProject.characters?.filter((c: any) => frame.character_ids?.includes(c.id));
        const promptParts: string[] = [];

        let motionPart = "";
        if (characters && characters.length > 0) {
            const charDescriptions = characters
                .map((c: any) => {
                    let desc = `${c.name} (${c.description}`;
                    if (c.clothing) desc += `, wearing ${c.clothing}`;
                    desc += `)`;
                    return desc;
                })
                .join(", ");
            motionPart += `Characters: ${charDescriptions}. `;
        }
        motionPart += `${frame.action_description || ""}`;
        if (frame.facial_expression) motionPart += `, ${frame.facial_expression}`;
        if (motionPart.trim()) promptParts.push(motionPart.trim());

        let cameraPart = "";
        if (frame.camera_angle) cameraPart += `${frame.camera_angle}`;
        if (frame.camera_movement) {
            if (cameraPart) cameraPart += ", ";
            cameraPart += `${frame.camera_movement}`;
        }
        if (frame.composition) {
            if (cameraPart) cameraPart += ", ";
            cameraPart += `${frame.composition}`;
        }
        if (cameraPart.trim()) promptParts.push(cameraPart.trim());

        let scenePart = "";
        if (scene) {
            scenePart += `${scene.description || scene.name}`;
            if (scene.time_of_day) scenePart += `, ${scene.time_of_day}`;
            if (scene.lighting_mood) scenePart += `, ${scene.lighting_mood}`;
        }
        if (frame.atmosphere) {
            if (scenePart) scenePart += ", ";
            scenePart += `${frame.atmosphere}`;
        }
        if (scenePart.trim()) promptParts.push(scenePart.trim());

        updateFrame({ image_prompt: promptParts.join(" . ") });
    };

    const handlePolish = async (feedback: string = "") => {
        setIsPolishing(true);
        const assets: { type: string; name: string; description?: string }[] = [];
        if (frame.scene_id) {
            const scene = currentProject.scenes?.find((s: any) => s.id === frame.scene_id);
            if (scene) assets.push({ type: "Scene", name: scene.name, description: scene.description });
        }
        if (frame.character_ids) {
            frame.character_ids.forEach((cid: string) => {
                const char = currentProject.characters?.find((c: any) => c.id === cid);
                if (char) assets.push({ type: "Character", name: char.name, description: char.description });
            });
        }
        if (frame.prop_ids) {
            frame.prop_ids.forEach((pid: string) => {
                const prop = currentProject.props?.find((p: any) => p.id === pid);
                if (prop) assets.push({ type: "Prop", name: prop.name, description: prop.description });
            });
        }
        const draft = feedback
            ? polishedPrompt?.en || frame.image_prompt || frame.action_description
            : frame.image_prompt || frame.action_description;
        try {
            const res = await api.refineFramePrompt(currentProject.id, frameId, draft, assets, feedback);
            if (res.prompt_cn && res.prompt_en) {
                setPolishedPrompt({ cn: res.prompt_cn, en: res.prompt_en });
                setFeedbackText("");
            }
        } catch (err) {
            console.error("Polish failed", err);
            alert("Prompt polishing failed");
        } finally {
            setIsPolishing(false);
        }
    };

    return (
        <div
            className={`flex h-full min-h-0 flex-col items-stretch gap-1.5 min-w-0 sm:flex-row ${className}`}
            onClick={(e) => e.stopPropagation()}
        >
            <div
                className={`flex h-full min-h-0 w-full shrink-0 flex-col gap-1.5 sm:basis-0 sm:min-w-0 ${
                    hideFirstFrameSection ? "sm:flex-1" : "sm:min-w-[8.5rem] sm:max-w-[16rem] sm:flex-1"
                }`}
            >
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                    <div className="flex min-h-0 flex-1 flex-col gap-1 basis-0">
                        <label className="shrink-0 text-[10px] font-bold uppercase text-gray-500">Action / Visuals</label>
                        <textarea
                            className="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-300 focus:border-primary/50 focus:outline-none"
                            value={frame.action_description || ""}
                            onChange={(e) => updateFrame({ action_description: e.target.value })}
                            placeholder="Describe the action..."
                        />
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1 basis-0">
                        <label className="shrink-0 text-[10px] font-bold uppercase text-gray-500">Dialogue</label>
                        <textarea
                            className="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-300 focus:border-primary/50 focus:outline-none"
                            value={frame.dialogue || ""}
                            onChange={(e) => updateFrame({ dialogue: e.target.value })}
                            placeholder="Speaker: Content"
                        />
                    </div>
                </div>
            </div>

            {!hideFirstFrameSection ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden sm:basis-0">
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">First frame</span>
                        <button
                            type="button"
                            onClick={handleComposePrompt}
                            className="flex items-center gap-1 text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition-colors"
                        >
                            <Wand2 size={10} /> Auto-Compose
                        </button>
                        <button
                            type="button"
                            onClick={() => handlePolish()}
                            disabled={isPolishing}
                            className="flex items-center gap-1 text-[10px] bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-white transition-colors disabled:opacity-50"
                        >
                            {isPolishing ? <Sparkles size={10} className="animate-spin" /> : <Sparkles size={10} />} Polish
                        </button>
                    </div>
                    <textarea
                        className="min-h-[4rem] w-full flex-1 resize-none overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1.5 text-xs text-gray-200 focus:border-primary/50 focus:outline-none"
                        value={frame.image_prompt || ""}
                        onChange={(e) => updateFrame({ image_prompt: e.target.value })}
                        placeholder="首帧 / 生图提示词…"
                    />

                    {polishedPrompt ? (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-h-36 shrink-0 space-y-2 overflow-y-auto overscroll-contain rounded-lg border border-purple-500/30 bg-purple-900/20 p-2 text-[10px]"
                    >
                    <div className="flex justify-between items-start gap-1">
                        <span className="font-bold text-purple-400 flex items-center gap-1">
                            <Wand2 size={10} /> 双语润色
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setPolishedPrompt(null);
                                setFeedbackText("");
                            }}
                            className="text-gray-400 hover:text-white shrink-0"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between gap-1">
                            <span className="text-[9px] font-bold text-gray-500">中文</span>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(polishedPrompt.cn);
                                    alert("已复制");
                                }}
                                className="text-gray-400 hover:text-white bg-black/20 px-1.5 py-0.5 rounded text-[9px]"
                            >
                                复制
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-300 whitespace-pre-wrap bg-black/20 p-1.5 rounded max-h-[3.75rem] overflow-y-auto">
                            {polishedPrompt.cn}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between gap-1">
                            <span className="text-[9px] font-bold text-gray-500">EN</span>
                            <div className="flex gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(polishedPrompt.en);
                                    }}
                                    className="text-gray-400 hover:text-white bg-black/20 px-1.5 py-0.5 rounded text-[9px]"
                                >
                                    Copy
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        updateFrame({
                                            image_prompt: polishedPrompt.en,
                                            image_prompt_cn: polishedPrompt.cn,
                                            image_prompt_en: polishedPrompt.en,
                                        });
                                        setPolishedPrompt(null);
                                    }}
                                    className="text-white bg-purple-600 hover:bg-purple-500 px-1.5 py-0.5 rounded font-bold text-[9px]"
                                >
                                    应用
                                </button>
                            </div>
                        </div>
                        <p className="text-[10px] text-gray-300 whitespace-pre-wrap bg-black/20 p-1.5 rounded font-mono max-h-[3.75rem] overflow-y-auto">
                            {polishedPrompt.en}
                        </p>
                    </div>
                    <div className="flex gap-1 pt-1 border-t border-purple-500/20">
                        <input
                            type="text"
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && feedbackText.trim() && !isPolishing) {
                                    handlePolish(feedbackText.trim());
                                }
                            }}
                            placeholder="修改意见…"
                            className="flex-1 min-w-0 text-[10px] bg-black/30 border border-purple-500/20 rounded px-2 py-1 text-white placeholder-gray-500 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => handlePolish(feedbackText.trim())}
                            disabled={isPolishing || !feedbackText.trim()}
                            className="text-[10px] text-white bg-purple-600 px-2 py-1 rounded disabled:opacity-50 shrink-0"
                        >
                            再润色
                        </button>
                    </div>
                    </motion.div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

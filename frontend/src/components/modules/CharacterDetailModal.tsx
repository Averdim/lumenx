"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, ChevronRight } from "lucide-react";
import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";

export type CharacterDetailModalAssetType = "scene" | "prop";

export interface CharacterDetailModalProps {
    asset: any;
    type: CharacterDetailModalAssetType;
    onClose: () => void;
    onUpdateDescription: (desc: string) => void;
    onGenerate: (applyStyle: boolean, negativePrompt: string, batchSize: number) => void;
    isGenerating: boolean;
    stylePrompt?: string;
    styleNegativePrompt?: string;
    onGenerateVideo: (prompt: string, duration: number) => void;
    onDeleteVideo: (videoId: string) => void;
    isGeneratingVideo: boolean;
}

export default function CharacterDetailModal({
    asset,
    type,
    onClose,
    onUpdateDescription,
    onGenerate,
    isGenerating,
    stylePrompt = "",
    styleNegativePrompt = "",
    onGenerateVideo,
    onDeleteVideo,
    isGeneratingVideo,
}: CharacterDetailModalProps) {
    const [description, setDescription] = useState(asset.description);
    const [isEditing, setIsEditing] = useState(false);
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    const [applyStyle, setApplyStyle] = useState(true);
    const [negativePrompt, setNegativePrompt] = useState(
        styleNegativePrompt ||
            "low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry"
    );
    const [showAdvanced, setShowAdvanced] = useState(false);

    const [activeTab, setActiveTab] = useState<"image" | "video">("image");
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");

    useEffect(() => {
        setDescription(asset.description);
        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
        else if (!videoPrompt) {
            setVideoPrompt(`Cinematic shot of ${asset.name}, ${asset.description}, looking around, breathing, slight movement, high quality, 4k`);
        }
    }, [asset]);

    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt.includes("low quality"))) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [styleNegativePrompt]);

    const handleSave = () => {
        onUpdateDescription(description);
        setIsEditing(false);
    };

    const handleSelectVariant = async (variantId: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, type, variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to select variant:", error);
        }
    };

    const handleDeleteVariant = async (variantId: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.deleteAssetVariant(currentProject.id, asset.id, type, variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
        }
    };

    const handleGenerateClick = (batchSize: number) => {
        onGenerate(applyStyle, negativePrompt, batchSize);
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a1a] shadow-2xl sm:flex-row"
            >
                <div className="relative flex w-full flex-col overflow-hidden border-b border-white/10 bg-black/40 sm:w-1/2 sm:border-b-0 sm:border-r">
                    <div className="flex border-b border-white/10 bg-black/20">
                        <button
                            type="button"
                            onClick={() => setActiveTab("image")}
                            className={`flex-1 p-3 text-sm font-bold transition-colors ${
                                activeTab === "image"
                                    ? "border-b-2 border-primary bg-white/5 text-white"
                                    : "text-gray-500 hover:text-gray-300"
                            }`}
                        >
                            Image Reference
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("video")}
                            className={`flex-1 p-3 text-sm font-bold transition-colors ${
                                activeTab === "video"
                                    ? "border-b-2 border-primary bg-white/5 text-white"
                                    : "text-gray-500 hover:text-gray-300"
                            }`}
                        >
                            Video Reference
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden p-4">
                        {activeTab === "image" ? (
                            <VariantSelector
                                asset={asset.image_asset}
                                currentImageUrl={asset.image_url}
                                onSelect={handleSelectVariant}
                                onDelete={handleDeleteVariant}
                                onGenerate={handleGenerateClick}
                                isGenerating={isGenerating}
                                aspectRatio="16:9"
                                className="h-full"
                            />
                        ) : (
                            <VideoVariantSelector
                                videos={asset.video_assets || []}
                                onDelete={onDeleteVideo}
                                onGenerate={(duration) => onGenerateVideo(videoPrompt, duration)}
                                isGenerating={isGeneratingVideo}
                                aspectRatio="16:9"
                                className="h-full"
                            />
                        )}
                    </div>
                </div>

                <div className="flex w-full flex-col sm:w-1/2">
                    <div className="flex items-center justify-between border-b border-white/10 bg-black/20 p-4 sm:p-6">
                        <h2 className="truncate text-xl font-bold text-white sm:text-2xl">{asset.name}</h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="shrink-0 rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-bold uppercase text-gray-400">Description</label>
                                {!isEditing && (
                                    <button type="button" onClick={() => setIsEditing(true)} className="text-xs text-primary hover:underline">
                                        Edit
                                    </button>
                                )}
                            </div>
                            {isEditing ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        className="h-32 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-gray-300 focus:border-primary focus:outline-none"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsEditing(false);
                                                setDescription(asset.description);
                                            }}
                                            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSave}
                                            className="rounded bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary/90"
                                        >
                                            Save Description
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="rounded-lg border border-transparent bg-white/5 p-3 text-sm leading-relaxed text-gray-300 transition-colors hover:border-white/10">
                                    {asset.description}
                                </p>
                            )}
                        </div>

                        {activeTab === "video" && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold uppercase text-gray-400">Video Prompt</label>
                                <textarea
                                    value={videoPrompt}
                                    onChange={(e) => setVideoPrompt(e.target.value)}
                                    className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-gray-300 focus:border-primary focus:outline-none"
                                    placeholder="Describe the motion..."
                                />
                            </div>
                        )}

                        {activeTab === "image" && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold uppercase text-gray-400">Style Settings</label>
                                <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                                    <div className="mb-2 flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="applyStyleModal"
                                            checked={applyStyle}
                                            onChange={(e) => setApplyStyle(e.target.checked)}
                                            className="rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary"
                                        />
                                        <label htmlFor="applyStyleModal" className="cursor-pointer select-none text-sm font-bold text-gray-300">
                                            Apply Art Direction Style
                                        </label>
                                    </div>

                                    {stylePrompt && (
                                        <div className="rounded border border-white/5 bg-black/20 p-2 font-mono text-xs text-gray-500">
                                            <span className="font-bold text-primary">Style:</span> {stylePrompt}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === "image" && (
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500 transition-colors hover:text-white"
                                >
                                    <span>Advanced Settings (Negative Prompt)</span>
                                    <ChevronRight size={12} className={`transform transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
                                </button>

                                <AnimatePresence>
                                    {showAdvanced && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden"
                                        >
                                            <textarea
                                                value={negativePrompt}
                                                onChange={(e) => setNegativePrompt(e.target.value)}
                                                className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-gray-400 focus:border-primary/50 focus:outline-none"
                                                placeholder="Enter negative prompt..."
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-4 border-t border-white/10 bg-black/20 p-4 sm:p-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-3 font-bold text-white shadow-lg shadow-green-900/20 hover:bg-green-500"
                        >
                            <Check size={18} />
                            Done
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

"use client";

import { motion } from "framer-motion";
import { FileText, Users, Layout, Mic, Music, Film, Info, StickyNote, Paintbrush } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";

interface PropertiesPanelProps {
    activeStep: string;
}

export default function PropertiesPanel({ activeStep }: PropertiesPanelProps) {
    const currentProject = useProjectStore((state) => state.currentProject);

    if (activeStep === "assembly") return null;

    const renderContent = () => {
        switch (activeStep) {
            case "script":
                return <ScriptInspector project={currentProject} />;
            case "assets":
                return <AssetsInspector project={currentProject} />;
            case "storyboard":
                return <StoryboardContextTip />;
            case "audio":
                return <AudioInspector project={currentProject} />;
            case "mix":
                return <MixInspector />;
            case "export":
                return <ExportInspector />;
            default:
                return <div className="p-4 text-gray-500">Select a step to view properties.</div>;
        }
    };

    return (
        <motion.aside
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="w-64 h-full border-l border-glass-border bg-black/40 backdrop-blur-xl flex flex-col z-50"
        >
            <div className="p-4 border-b border-glass-border flex items-center justify-between">
                <h2 className="font-display font-bold text-white flex items-center gap-2">
                    <Info size={16} className="text-primary" /> Context
                </h2>
                <span className="text-xs font-mono text-gray-500 uppercase">{activeStep}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {renderContent()}
            </div>
        </motion.aside>
    );
}

// --- Sub-Inspectors ---

function ScriptInspector({ project }: { project: any }) {
    if (!project) return null;
    const wordCount = project.originalText?.length || 0;
    const charCount = project.characters?.length || 0;
    const sceneCount = project.scenes?.length || 0;

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileText size={14} /> Project Stats
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    <StatBox label="Words" value={wordCount} />
                    <StatBox label="Chars" value={charCount} />
                    <StatBox label="Scenes" value={sceneCount} />
                    <StatBox label="Est. Dur" value="~2m" />
                </div>
            </div>

            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <StickyNote size={14} /> Quick Notes
                </h3>
                <textarea
                    className="w-full h-32 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50"
                    placeholder="Jot down ideas here..."
                />
            </div>

            <div className="pt-4 border-t border-white/10">
                <ArtDirectionStyleDisplay project={project} />
            </div>
        </div>
    );
}

function AssetsInspector({ project }: { project: any }) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    // Get art direction style from Step 2
    const artDirectionStyle = currentProject?.art_direction?.style_config;

    // Get aspect ratios from model settings
    const characterAspectRatio = currentProject?.model_settings?.character_aspect_ratio || '9:16';
    const sceneAspectRatio = currentProject?.model_settings?.scene_aspect_ratio || '16:9';
    const propAspectRatio = currentProject?.model_settings?.prop_aspect_ratio || '1:1';

    const handleUpdateAspectRatio = async (type: 'character' | 'scene' | 'prop', ratio: string) => {
        if (!currentProject) return;

        try {
            const updatePayload: any = {};
            if (type === 'character') updatePayload.character_aspect_ratio = ratio;
            else if (type === 'scene') updatePayload.scene_aspect_ratio = ratio;
            else if (type === 'prop') updatePayload.prop_aspect_ratio = ratio;

            const updated = await api.updateModelSettings(
                currentProject.id,
                undefined, undefined, undefined,
                type === 'character' ? ratio : undefined,
                type === 'scene' ? ratio : undefined,
                type === 'prop' ? ratio : undefined,
                undefined,
                undefined
            );
            updateProject(currentProject.id, updated);
        } catch (error) {
            console.error('Failed to update aspect ratio:', error);
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users size={14} /> Asset Overview
                </h3>
                <div className="text-xs text-gray-400">
                    Manage aspect ratios and view global style settings.
                </div>
            </div>

            {/* Aspect Ratio Controls */}
            <div className="space-y-4 pt-4 border-t border-white/10">
                <div className="flex items-center gap-2 mb-2">
                    <Layout className="text-primary" size={14} />
                    <h3 className="font-bold text-white text-xs">Aspect Ratios</h3>
                </div>

                {/* Character Aspect Ratio */}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Character</label>
                    <div className="grid grid-cols-3 gap-1.5">
                        {['9:16', '16:9', '1:1'].map((ratio) => (
                            <button
                                key={ratio}
                                onClick={() => handleUpdateAspectRatio('character', ratio)}
                                className={`px-2 py-1.5 rounded text-[10px] border transition-all font-medium ${characterAspectRatio === ratio
                                    ? 'bg-primary/20 text-primary border-primary/30'
                                    : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                            >
                                {ratio}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Scene Aspect Ratio */}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Scene</label>
                    <div className="grid grid-cols-3 gap-1.5">
                        {['9:16', '16:9', '1:1'].map((ratio) => (
                            <button
                                key={ratio}
                                onClick={() => handleUpdateAspectRatio('scene', ratio)}
                                className={`px-2 py-1.5 rounded text-[10px] border transition-all font-medium ${sceneAspectRatio === ratio
                                    ? 'bg-primary/20 text-primary border-primary/30'
                                    : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                            >
                                {ratio}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Prop Aspect Ratio */}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Prop</label>
                    <div className="grid grid-cols-3 gap-1.5">
                        {['9:16', '16:9', '1:1'].map((ratio) => (
                            <button
                                key={ratio}
                                onClick={() => handleUpdateAspectRatio('prop', ratio)}
                                className={`px-2 py-1.5 rounded text-[10px] border transition-all font-medium ${propAspectRatio === ratio
                                    ? 'bg-primary/20 text-primary border-primary/30'
                                    : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                            >
                                {ratio}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Art Direction Style Display (Read-only) */}
            <div className="pt-4 border-t border-white/10">
                <ArtDirectionStyleDisplay project={currentProject} />
            </div>
        </div>
    );
}

function ArtDirectionStyleDisplay({ project }: { project: any }) {
    const artDirectionStyle = project?.art_direction?.style_config;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
                <Paintbrush className="text-primary" size={14} />
                <h3 className="font-bold text-white text-xs">Art Direction Style</h3>
            </div>

            {artDirectionStyle ? (
                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">Style Name</label>
                        <div className="text-xs font-bold text-white bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-2.5 rounded-lg border border-white/10">
                            {artDirectionStyle.name}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">Positive Prompt</label>
                        <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 text-[10px] text-gray-400 leading-relaxed max-h-20 overflow-y-auto">
                            {artDirectionStyle.positive_prompt || 'No positive prompt defined'}
                        </div>
                    </div>

                    {artDirectionStyle.negative_prompt && (
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">Negative Prompt</label>
                            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 text-[10px] text-gray-400 leading-relaxed max-h-16 overflow-y-auto">
                                {artDirectionStyle.negative_prompt}
                            </div>
                        </div>
                    )}

                    <div className="pt-2">
                        <p className="text-[9px] text-gray-500 leading-relaxed">
                            💡 Tip: Edit style in Step 2 (Art Direction)
                        </p>
                    </div>
                </div>
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-2">No style configured</p>
                    <p className="text-[9px] text-gray-600">
                        Go to Step 2 (Art Direction) to set up your project's visual style
                    </p>
                </div>
            )}
        </div>
    );
}
function StoryboardContextTip() {
    return (
        <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
            <p>
                分镜的动作、对白、场景/角色/道具、机位与首帧提示词（含 Auto-Compose / Polish）已在主区域
                <span className="text-gray-200 font-medium"> 每一行下方 </span>
                展开编辑。
            </p>
            <p className="text-[10px] text-gray-600">画幅与模型预设仍使用顶部 ⚙ 与项目设置。</p>
        </div>
    );
}

function AudioInspector({ project }: { project: any }) {
    const assignedCount = project?.characters?.filter((c: any) => c.voice_id).length || 0;
    const totalCount = project?.characters?.length || 0;

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Mic size={14} /> Casting Status
                </h3>
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-green-500 transition-all duration-500"
                            style={{ width: `${(assignedCount / totalCount) * 100}%` }}
                        />
                    </div>
                    <span className="text-xs font-mono text-gray-400">{assignedCount}/{totalCount}</span>
                </div>
                <p className="text-xs text-gray-500">
                    {assignedCount === totalCount ? "All characters casted." : "Some characters need voices."}
                </p>
            </div>
        </div>
    );
}

function MixInspector() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Music size={14} /> Track Inspector
                </h3>
                <div className="p-4 bg-white/5 rounded-lg border border-white/10 text-center text-xs text-gray-500">
                    Select a clip on the timeline to view details.
                </div>
            </div>
        </div>
    );
}

function ExportInspector() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Film size={14} /> Export History
                </h3>
                <div className="space-y-2">
                    <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between items-center">
                        <span className="text-xs text-gray-300">Project_v1.mp4</span>
                        <span className="text-[10px] text-gray-500">2h ago</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatBox({ label, value }: { label: string, value: string | number }) {
    return (
        <div className="bg-white/5 border border-white/10 rounded p-2 text-center">
            <div className="text-lg font-bold text-white">{value}</div>
            <div className="text-[10px] text-gray-500 uppercase">{label}</div>
        </div>
    );
}

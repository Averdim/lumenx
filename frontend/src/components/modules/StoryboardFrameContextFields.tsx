"use client";

import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";

/**
 * Inline storyboard frame editing (formerly StoryboardInspector in PropertiesPanel).
 * Renders all fields expanded; parent should wrap with stopPropagation if needed.
 */
export default function StoryboardFrameContextFields({ frameId }: { frameId: string }) {
    const currentProject = useProjectStore((s) => s.currentProject);
    const updateProject = useProjectStore((s) => s.updateProject);

    const frame = currentProject?.frames?.find((f: any) => f.id === frameId) ?? null;

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

    const toggleCharacter = (charId: string) => {
        const currentIds = frame.character_ids || [];
        const newIds = currentIds.includes(charId) ? currentIds.filter((id: string) => id !== charId) : [...currentIds, charId];
        updateFrame({ character_ids: newIds });
    };

    const selectedScene = currentProject.scenes?.find((s: any) => s.id === frame.scene_id);
    const sceneHasImage = selectedScene?.image_url;
    const selectedChars = currentProject.characters?.filter((c: any) => frame.character_ids?.includes(c.id));
    const charImageCount = selectedChars?.filter((c: any) => c.image_url || c.avatar_url).length || 0;
    const selectedProps = currentProject.props?.filter((p: any) => frame.prop_ids?.includes(p.id));
    const propImageCount = selectedProps?.filter((p: any) => p.image_url).length || 0;
    const referenceCount = (sceneHasImage ? 1 : 0) + charImageCount + propImageCount;
    const i2iModel = currentProject.model_settings?.i2i_model;
    const referenceLimit = i2iModel === "wan2.6-image" ? 4 : 3;
    const isLimitReached = referenceCount >= referenceLimit;

    return (
        <div className="space-y-3 pt-2 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">分镜编辑</div>

            <div className="max-h-[min(38vh,15rem)] space-y-3 overflow-y-auto overscroll-contain pr-0.5">
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Reference Assets</label>
                    <span className={`text-[9px] ${isLimitReached ? "text-yellow-500 font-bold" : "text-gray-500"}`}>
                        {referenceCount}/{referenceLimit} Images
                    </span>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">Scene</label>
                    <select
                        className="w-full bg-black/30 border border-white/10 rounded p-2 text-xs text-gray-300 focus:outline-none"
                        value={frame.scene_id || ""}
                        onChange={(e) => {
                            const newSceneId = e.target.value;
                            const newScene = currentProject.scenes?.find((s: any) => s.id === newSceneId);
                            const newSceneHasImage = newScene?.image_url;
                            const predictedCount = (newSceneHasImage ? 1 : 0) + charImageCount + propImageCount;
                            if (predictedCount > referenceLimit) {
                                alert(
                                    `Cannot select this scene: Reference image limit (${referenceLimit}) would be exceeded. Deselect some characters or props first.`
                                );
                                return;
                            }
                            updateFrame({ scene_id: newSceneId });
                        }}
                    >
                        <option value="">Select Scene...</option>
                        {currentProject.scenes?.map((scene: any) => (
                            <option key={scene.id} value={scene.id}>
                                {scene.name}
                            </option>
                        ))}
                    </select>
                    {selectedScene?.description ? (
                        <div className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                            <span className="font-bold not-italic text-gray-500">Scene: </span>
                            {selectedScene.description}
                        </div>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] font-bold text-gray-500 uppercase">Characters</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {currentProject.characters?.map((char: any) => {
                            const isSelected = frame.character_ids?.includes(char.id);
                            const hasImage = char.image_url || char.avatar_url;
                            const isDisabled = !isSelected && hasImage && isLimitReached;
                            return (
                                <button
                                    key={char.id}
                                    type="button"
                                    disabled={isDisabled}
                                    onClick={() => {
                                        if (isDisabled) return;
                                        toggleCharacter(char.id);
                                    }}
                                    className={`flex items-center gap-2 p-2 rounded border text-xs transition-all ${
                                        isSelected
                                            ? "bg-primary/20 border-primary text-white"
                                            : isDisabled
                                              ? "bg-black/10 border-white/5 text-gray-600 cursor-not-allowed opacity-50"
                                              : "bg-black/20 border-white/10 text-gray-400 hover:bg-white/5"
                                    }`}
                                >
                                    <div className="w-4 h-4 rounded-full bg-gray-700 overflow-hidden flex-shrink-0">
                                        {char.avatar_url ? (
                                            <img src={getAssetUrl(char.avatar_url)} className="w-full h-full object-cover" alt="" />
                                        ) : null}
                                    </div>
                                    <span className="truncate">{char.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    {selectedChars && selectedChars.length > 0 ? (
                        <div className="space-y-1">
                            {selectedChars.map((char: any) => (
                                <div key={char.id} className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                                    <span className="font-bold not-italic text-gray-500">{char.name}: </span>
                                    {char.description}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                {currentProject.props && currentProject.props.length > 0 ? (
                    <div className="space-y-2">
                        <label className="text-[9px] font-bold text-gray-500 uppercase">Props</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {currentProject.props.map((prop: any) => {
                                const isSelected = frame.prop_ids?.includes(prop.id);
                                const hasImage = prop.image_url;
                                const isDisabled = !isSelected && hasImage && isLimitReached;
                                return (
                                    <button
                                        key={prop.id}
                                        type="button"
                                        disabled={isDisabled}
                                        onClick={() => {
                                            if (isDisabled) return;
                                            const currentProps = frame.prop_ids || [];
                                            const newProps = currentProps.includes(prop.id)
                                                ? currentProps.filter((id: string) => id !== prop.id)
                                                : [...currentProps, prop.id];
                                            updateFrame({ prop_ids: newProps });
                                        }}
                                        className={`flex items-center gap-2 p-2 rounded border text-xs transition-all ${
                                            isSelected
                                                ? "bg-primary/20 border-primary text-white"
                                                : isDisabled
                                                  ? "bg-black/10 border-white/5 text-gray-600 cursor-not-allowed opacity-50"
                                                  : "bg-black/20 border-white/10 text-gray-400 hover:bg-white/5"
                                        }`}
                                    >
                                        <div className="w-4 h-4 rounded bg-gray-700 overflow-hidden flex-shrink-0">
                                            {prop.image_url ? (
                                                <img src={getAssetUrl(prop.image_url)} className="w-full h-full object-cover" alt="" />
                                            ) : null}
                                        </div>
                                        <span className="truncate">{prop.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {(() => {
                            const sp = currentProject.props!.filter((p: any) => frame.prop_ids?.includes(p.id));
                            if (!sp.length) return null;
                            return (
                                <div className="space-y-1">
                                    {sp.map((prop: any) => (
                                        <div key={prop.id} className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                                            <span className="font-bold not-italic text-gray-500">{prop.name}: </span>
                                            {prop.description}
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                ) : null}
            </div>

            <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Camera</label>
                <select
                    className="w-full max-w-xs bg-black/30 border border-white/10 rounded p-2 text-xs text-gray-300 focus:outline-none"
                    value={frame.camera_angle || ""}
                    onChange={(e) => updateFrame({ camera_angle: e.target.value })}
                >
                    <option value="">Angle...</option>
                    <option value="Wide Shot">Wide Shot</option>
                    <option value="Medium Shot">Medium Shot</option>
                    <option value="Close Up">Close Up</option>
                    <option value="Low Angle">Low Angle</option>
                    <option value="High Angle">High Angle</option>
                    <option value="Over the Shoulder">Over the Shoulder</option>
                </select>
            </div>
            </div>

        </div>
    );
}

/**
 * Build ordered reference image URLs for a storyboard frame (scene + characters + props).
 * Mirrors StoryboardComposer.handleRenderFrame composition logic for reuse in StoryboardVideoWorkbench.
 */

/** Accepts ImageAsset / loose API shapes (selected_id may be null). */
export function getSelectedVariantUrl(asset: any): string | null {
    if (!asset?.variants?.length) return null;
    if (asset.selected_id) {
        const selected = asset.variants.find((v: { id: string }) => v.id === asset.selected_id);
        if (selected?.url) return selected.url;
    }
    return asset.variants[0]?.url || null;
}

export type FrameReferenceThumb = { url: string; label: string };

export function buildFrameReferenceThumbnails(project: {
    scenes?: { id: string; name?: string; image_asset?: any; image_url?: string }[];
    characters?: {
        id: string;
        name?: string;
        three_view_asset?: any;
        full_body_asset?: any;
        headshot_asset?: any;
        three_view_image_url?: string;
        full_body_image_url?: string;
        headshot_image_url?: string;
        avatar_url?: string;
        image_url?: string;
    }[];
    props?: { id: string; name?: string; image_asset?: any; image_url?: string }[];
}, frame: {
    scene_id?: string;
    character_ids?: string[];
    prop_ids?: string[];
}): FrameReferenceThumb[] {
    const out: FrameReferenceThumb[] = [];

    if (frame.scene_id && project.scenes) {
        const scene = project.scenes.find((s) => s.id === frame.scene_id);
        if (scene) {
            const u = getSelectedVariantUrl(scene.image_asset) || scene.image_url;
            if (u) out.push({ url: u, label: scene.name || "Scene" });
        }
    }

    if (frame.character_ids?.length && project.characters) {
        frame.character_ids.forEach((charId) => {
            const char = project.characters!.find((c) => c.id === charId);
            if (!char) return;
            const u =
                getSelectedVariantUrl(char.three_view_asset) ||
                getSelectedVariantUrl(char.full_body_asset) ||
                getSelectedVariantUrl(char.headshot_asset) ||
                char.three_view_image_url ||
                char.full_body_image_url ||
                char.headshot_image_url ||
                char.avatar_url ||
                char.image_url;
            if (u) out.push({ url: u, label: char.name || "Char" });
        });
    }

    if (frame.prop_ids?.length && project.props) {
        frame.prop_ids.forEach((propId) => {
            const prop = project.props!.find((p) => p.id === propId);
            if (!prop) return;
            const u = getSelectedVariantUrl(prop.image_asset) || prop.image_url;
            if (u) out.push({ url: u, label: prop.name || "Prop" });
        });
    }

    return out;
}

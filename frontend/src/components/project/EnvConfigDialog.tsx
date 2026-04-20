"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, ChevronDown, ChevronRight, Loader2, Key } from "lucide-react";
import { api, type EnvConfigPayload, type ProviderMode } from "@/lib/api";

interface EnvConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isRequired?: boolean;
}

type EnvConfig = EnvConfigPayload & {
  DASHSCOPE_API_KEY: string;
  MINIO_ENDPOINT: string;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET: string;
  MINIO_USE_SSL: string;
  MINIO_BASE_PATH: string;
  MINIO_REGION: string;
  KLING_PROVIDER_MODE: ProviderMode;
  VIDU_PROVIDER_MODE: ProviderMode;
  PIXVERSE_PROVIDER_MODE: ProviderMode;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
  VIDU_API_KEY: string;
  ARK_API_KEY: string;
  OPENAI_KONGYANG_API_KEY: string;
  OPENAI_GEEKNOW_API_KEY: string;
  endpoint_overrides: Record<string, string>;
};

const ENDPOINT_PROVIDERS = [
  { key: "DASHSCOPE_BASE_URL", label: "DashScope", placeholder: "https://dashscope.aliyuncs.com" },
  { key: "KLING_BASE_URL", label: "Kling", placeholder: "https://api-beijing.klingai.com/v1" },
  { key: "VIDU_BASE_URL", label: "Vidu", placeholder: "https://api.vidu.cn/ent/v2" },
  { key: "OPENAI_KONGYANG_BASE_URL", label: "空氧 (LLM)", placeholder: "https://your-kongyang.example/v1" },
  { key: "OPENAI_GEEKNOW_BASE_URL", label: "GeekNow (LLM)", placeholder: "https://your-geeknow.example/v1" },
];

const DEFAULT_CONFIG: EnvConfig = {
  DASHSCOPE_API_KEY: "",
  MINIO_ENDPOINT: "",
  MINIO_ACCESS_KEY: "",
  MINIO_SECRET_KEY: "",
  MINIO_BUCKET: "",
  MINIO_USE_SSL: "false",
  MINIO_BASE_PATH: "",
  MINIO_REGION: "",
  KLING_PROVIDER_MODE: "dashscope",
  VIDU_PROVIDER_MODE: "dashscope",
  PIXVERSE_PROVIDER_MODE: "dashscope",
  KLING_ACCESS_KEY: "",
  KLING_SECRET_KEY: "",
  VIDU_API_KEY: "",
  ARK_API_KEY: "",
  OPENAI_KONGYANG_API_KEY: "",
  OPENAI_GEEKNOW_API_KEY: "",
  endpoint_overrides: {},
};

const normalizeProviderMode = (mode?: string): ProviderMode => (mode === "vendor" ? "vendor" : "dashscope");

const normalizeEnvConfig = (existing: EnvConfig, data?: EnvConfigPayload): EnvConfig => ({
  ...existing,
  ...data,
  KLING_PROVIDER_MODE: normalizeProviderMode(data?.KLING_PROVIDER_MODE ?? existing.KLING_PROVIDER_MODE),
  VIDU_PROVIDER_MODE: normalizeProviderMode(data?.VIDU_PROVIDER_MODE ?? existing.VIDU_PROVIDER_MODE),
  PIXVERSE_PROVIDER_MODE: normalizeProviderMode(data?.PIXVERSE_PROVIDER_MODE ?? existing.PIXVERSE_PROVIDER_MODE),
  endpoint_overrides: data?.endpoint_overrides ?? existing.endpoint_overrides ?? {},
});

const getValidationErrors = (env: EnvConfig): string[] => {
  const errors: string[] = [];

  if (!env.DASHSCOPE_API_KEY?.trim()) {
    errors.push("DashScope API Key");
  }
  if (env.KLING_PROVIDER_MODE === "vendor") {
    if (!env.KLING_ACCESS_KEY?.trim()) {
      errors.push("Kling Access Key (vendor mode)");
    }
    if (!env.KLING_SECRET_KEY?.trim()) {
      errors.push("Kling Secret Key (vendor mode)");
    }
  }
  if (env.VIDU_PROVIDER_MODE === "vendor" && !env.VIDU_API_KEY?.trim()) {
    errors.push("Vidu API Key (vendor mode)");
  }

  return errors;
};

export default function EnvConfigDialog({ isOpen, onClose, isRequired = false }: EnvConfigDialogProps) {
  const [config, setConfig] = useState<EnvConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getEnvConfig();
      setConfig((prev) => normalizeEnvConfig(prev, data));
    } catch (error) {
      console.error("Failed to load env config:", error);
      setLoadError("Failed to load configuration. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const validateRequiredFields = () => getValidationErrors(config).length === 0;
  const canClose = !isRequired || validateRequiredFields();

  const handleSave = async () => {
    const errors = getValidationErrors(config);
    if (errors.length > 0) {
      alert(`Please fill in required fields:\n- ${errors.join("\n- ")}`);
      return;
    }

    setSaving(true);
    try {
      await api.saveEnvConfig(config);
      alert("Configuration saved successfully!");
      onClose();
      if (isRequired) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to save env config:", error);
      alert("Failed to save configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof EnvConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleEndpointChange = (envKey: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      endpoint_overrides: { ...prev.endpoint_overrides, [envKey]: value },
    }));
  };

  const requestClose = () => {
    if (canClose) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const inputClass = "w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 transition-colors";
  const modeButtonClass = (active: boolean) =>
    `px-3 py-1.5 text-xs rounded-md border transition-colors ${active ? "border-amber-500/60 bg-amber-500/15 text-amber-200" : "border-white/10 bg-white/5 text-gray-400 hover:text-gray-200"}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={requestClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-[#1a1a1a] rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-lg">
                <Key size={20} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Environment Configuration</h2>
                <p className="text-xs text-gray-500">DashScope-first setup, with optional MinIO storage and vendor-direct routing</p>
              </div>
            </div>
            <button
              onClick={requestClose}
              disabled={!canClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {isRequired && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-300">
                DashScope API Key is required before using the app. MinIO and vendor keys are optional unless you select vendor-direct mode.
              </div>
            )}
            {isRequired && !canClose && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-gray-400">
                This dialog cannot be closed until required fields are valid.
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-amber-400" />
                <span className="ml-2 text-gray-400">Loading configuration...</span>
              </div>
            ) : loadError ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300">
                {loadError}
              </div>
            ) : (
              <>
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                    <span>DashScope API Key <span className="text-red-500">*</span></span>
                    <span className="text-gray-600 font-normal text-xs">e.g. sk-xxx</span>
                  </label>
                  <input
                    type="password"
                    value={config.DASHSCOPE_API_KEY}
                    onChange={(e) => handleChange("DASHSCOPE_API_KEY", e.target.value)}
                    placeholder="Required for DashScope-first model routing"
                    className={inputClass}
                  />
                </div>

                <div className="pt-4 border-t border-white/10">
                  <h3 className="text-sm font-bold text-white mb-2">空氧 / GeekNow (LLM, optional)</h3>
                  <p className="text-[10px] text-gray-500 mb-4">
                    OpenAI-compatible chat. Use when project generation settings set LLM channel to{" "}
                    <code className="text-gray-400">openai_kongyang</code> or{" "}
                    <code className="text-gray-400">openai_geeknow</code>. Set matching API Key here and Base URL under
                    Advanced.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        空氧 API Key (OPENAI_KONGYANG_API_KEY)
                      </label>
                      <input
                        type="password"
                        value={config.OPENAI_KONGYANG_API_KEY}
                        onChange={(e) => handleChange("OPENAI_KONGYANG_API_KEY", e.target.value)}
                        placeholder="Optional; for Kongyang / 空氧 LLM channel"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        GeekNow API Key (OPENAI_GEEKNOW_API_KEY)
                      </label>
                      <input
                        type="password"
                        value={config.OPENAI_GEEKNOW_API_KEY}
                        onChange={(e) => handleChange("OPENAI_GEEKNOW_API_KEY", e.target.value)}
                        placeholder="Optional; for GeekNow LLM channel"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-white">MinIO / S3 (Optional)</h3>
                    <p className="text-[10px] text-gray-500 mt-1">S3-compatible storage. Local-first; uploads go to MinIO when configured.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_ENDPOINT</label>
                      <input
                        type="text"
                        value={config.MINIO_ENDPOINT}
                        onChange={(e) => handleChange("MINIO_ENDPOINT", e.target.value)}
                        placeholder="127.0.0.1:9000"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_ACCESS_KEY</label>
                      <input
                        type="password"
                        value={config.MINIO_ACCESS_KEY}
                        onChange={(e) => handleChange("MINIO_ACCESS_KEY", e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_SECRET_KEY</label>
                      <input
                        type="password"
                        value={config.MINIO_SECRET_KEY}
                        onChange={(e) => handleChange("MINIO_SECRET_KEY", e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_BUCKET</label>
                      <input
                        type="text"
                        value={config.MINIO_BUCKET}
                        onChange={(e) => handleChange("MINIO_BUCKET", e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_USE_SSL</label>
                      <input
                        type="text"
                        value={config.MINIO_USE_SSL}
                        onChange={(e) => handleChange("MINIO_USE_SSL", e.target.value)}
                        placeholder="false"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_BASE_PATH</label>
                      <input
                        type="text"
                        value={config.MINIO_BASE_PATH}
                        onChange={(e) => handleChange("MINIO_BASE_PATH", e.target.value)}
                        placeholder="lumenx"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">MINIO_REGION (optional)</label>
                      <input
                        type="text"
                        value={config.MINIO_REGION}
                        onChange={(e) => handleChange("MINIO_REGION", e.target.value)}
                        placeholder="us-east-1"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">Kling Provider</h3>
                    <span className="text-[10px] text-gray-500">Choose DashScope proxy or vendor-direct</span>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleChange("KLING_PROVIDER_MODE", "dashscope")}
                        className={modeButtonClass(config.KLING_PROVIDER_MODE === "dashscope")}
                      >
                        DashScope
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange("KLING_PROVIDER_MODE", "vendor")}
                        className={modeButtonClass(config.KLING_PROVIDER_MODE === "vendor")}
                      >
                        Vendor Direct
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      DashScope mode uses your DashScope API key. Vendor-direct mode requires Kling Access Key and Secret Key.
                    </p>

                    {config.KLING_PROVIDER_MODE === "vendor" && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Kling Access Key <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="password"
                            value={config.KLING_ACCESS_KEY}
                            onChange={(e) => handleChange("KLING_ACCESS_KEY", e.target.value)}
                            placeholder="Kling API Access Key"
                            className={inputClass}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Kling Secret Key <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="password"
                            value={config.KLING_SECRET_KEY}
                            onChange={(e) => handleChange("KLING_SECRET_KEY", e.target.value)}
                            placeholder="Kling API Secret Key"
                            className={inputClass}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">Vidu Provider</h3>
                    <span className="text-[10px] text-gray-500">Choose DashScope proxy or vendor-direct</span>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleChange("VIDU_PROVIDER_MODE", "dashscope")}
                        className={modeButtonClass(config.VIDU_PROVIDER_MODE === "dashscope")}
                      >
                        DashScope
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange("VIDU_PROVIDER_MODE", "vendor")}
                        className={modeButtonClass(config.VIDU_PROVIDER_MODE === "vendor")}
                      >
                        Vendor Direct
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      DashScope mode uses your DashScope API key. Vendor-direct mode requires a Vidu API key.
                    </p>

                    {config.VIDU_PROVIDER_MODE === "vendor" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Vidu API Key <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="password"
                          value={config.VIDU_API_KEY}
                          onChange={(e) => handleChange("VIDU_API_KEY", e.target.value)}
                          placeholder="Vidu API Key"
                          className={inputClass}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <h3 className="text-sm font-bold text-white mb-4">Volcengine Ark (Seedance)</h3>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                    <p className="text-xs text-gray-500">
                      For video models with id <code className="text-gray-400">doubao-*</code> or{" "}
                      <code className="text-gray-400">seedance*</code>. Optional otherwise.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">ARK API Key</label>
                      <input
                        type="password"
                        value={config.ARK_API_KEY}
                        onChange={(e) => handleChange("ARK_API_KEY", e.target.value)}
                        placeholder="Volcengine Ark API Key"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setEndpointsOpen(!endpointsOpen)}
                    aria-expanded={endpointsOpen}
                    className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {endpointsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    Advanced: API Endpoints
                  </button>

                  {endpointsOpen && (
                    <div className="mt-4 space-y-4">
                      <p className="text-xs text-gray-500">
                        Custom API endpoint URLs. Leave empty to use defaults. Endpoint overrides are preserved regardless of provider mode.
                      </p>
                      {ENDPOINT_PROVIDERS.map(({ key, label, placeholder }) => (
                        <div key={key}>
                          <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                            <span>{label} Base URL</span>
                            <span className="text-gray-600 font-normal text-xs">{placeholder}</span>
                          </label>
                          <input
                            type="text"
                            value={config.endpoint_overrides[key] || ""}
                            onChange={(e) => handleEndpointChange(key, e.target.value)}
                            placeholder={placeholder}
                            className={inputClass + " text-sm"}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-white/10">
            <button
              onClick={requestClose}
              disabled={!canClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !!loadError}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

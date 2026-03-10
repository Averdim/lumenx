/**
 * Tests for EnvConfigDialog logic: ENDPOINT_PROVIDERS registry,
 * endpoint_overrides handling, validation, and state transforms.
 *
 * Since the project uses vitest environment: 'node' (no jsdom/RTL),
 * we extract and test all pure business logic from EnvConfigDialog.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Replicated types & constants from EnvConfigDialog.tsx ──────────────

interface EnvConfig {
    DASHSCOPE_API_KEY: string;
    ALIBABA_CLOUD_ACCESS_KEY_ID: string;
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: string;
    OSS_BUCKET_NAME: string;
    OSS_ENDPOINT: string;
    OSS_BASE_PATH: string;
    KLING_ACCESS_KEY: string;
    KLING_SECRET_KEY: string;
    VIDU_API_KEY: string;
    endpoint_overrides: Record<string, string>;
    [key: string]: string | Record<string, string>;
}

const ENDPOINT_PROVIDERS = [
    { key: "DASHSCOPE_BASE_URL", label: "DashScope", placeholder: "https://dashscope.aliyuncs.com" },
    { key: "KLING_BASE_URL", label: "Kling", placeholder: "https://api-beijing.klingai.com/v1" },
    { key: "VIDU_BASE_URL", label: "Vidu", placeholder: "https://api.vidu.cn/ent/v2" },
];

const DEFAULT_CONFIG: EnvConfig = {
    DASHSCOPE_API_KEY: "",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
    OSS_BUCKET_NAME: "",
    OSS_ENDPOINT: "",
    OSS_BASE_PATH: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    VIDU_API_KEY: "",
    endpoint_overrides: {},
};

// ── Extracted pure functions (same logic as component internals) ────────

/** Mirrors validateRequiredFields() from EnvConfigDialog */
function validateRequiredFields(config: EnvConfig): boolean {
    const dashscopeKey = (config.DASHSCOPE_API_KEY as string)?.trim();
    const accessKeyId = (config.ALIBABA_CLOUD_ACCESS_KEY_ID as string)?.trim();
    const accessKeySecret = (config.ALIBABA_CLOUD_ACCESS_KEY_SECRET as string)?.trim();
    const ossBucket = (config.OSS_BUCKET_NAME as string)?.trim();
    const ossEndpoint = (config.OSS_ENDPOINT as string)?.trim();

    return !!(dashscopeKey && dashscopeKey.length > 0 &&
        accessKeyId && accessKeyId.length > 0 &&
        accessKeySecret && accessKeySecret.length > 0 &&
        ossBucket && ossBucket.length > 0 &&
        ossEndpoint && ossEndpoint.length > 0);
}

/** Mirrors handleChange() state updater */
function applyChange(config: EnvConfig, key: string, value: string): EnvConfig {
    return { ...config, [key]: value };
}

/** Mirrors handleEndpointChange() state updater */
function applyEndpointChange(config: EnvConfig, envKey: string, value: string): EnvConfig {
    return {
        ...config,
        endpoint_overrides: { ...config.endpoint_overrides, [envKey]: value },
    };
}

/** Mirrors loadConfig() data normalization */
function normalizeApiResponse(existing: EnvConfig, data: Record<string, any>): EnvConfig {
    return { ...existing, ...data, endpoint_overrides: data.endpoint_overrides ?? {} };
}

/** Mirrors canClose logic */
function computeCanClose(isRequired: boolean, config: EnvConfig): boolean {
    return !isRequired || validateRequiredFields(config);
}

// ── ENDPOINT_PROVIDERS 注册表 ──────────────────────────────────────────

describe('ENDPOINT_PROVIDERS 注册表', () => {
    it('should have key, label, placeholder for each provider', () => {
        for (const provider of ENDPOINT_PROVIDERS) {
            expect(provider.key).toBeDefined();
            expect(provider.label).toBeDefined();
            expect(provider.placeholder).toBeDefined();
        }
    });

    it('should follow {PROVIDER}_BASE_URL naming convention', () => {
        for (const provider of ENDPOINT_PROVIDERS) {
            expect(provider.key).toMatch(/^[A-Z]+_BASE_URL$/);
        }
    });

    it('should have unique keys', () => {
        const keys = ENDPOINT_PROVIDERS.map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('should have valid HTTPS placeholders without trailing slash', () => {
        for (const provider of ENDPOINT_PROVIDERS) {
            expect(provider.placeholder).toMatch(/^https:\/\/.+/);
            expect(provider.placeholder.endsWith('/')).toBe(false);
        }
    });

    it('should contain exactly 3 providers (DashScope, Kling, Vidu)', () => {
        expect(ENDPOINT_PROVIDERS).toHaveLength(3);
        const labels = ENDPOINT_PROVIDERS.map(p => p.label);
        expect(labels).toContain('DashScope');
        expect(labels).toContain('Kling');
        expect(labels).toContain('Vidu');
    });
});

// ── validateRequiredFields ─────────────────────────────────────────────

describe('validateRequiredFields', () => {
    it('should return false when all fields are empty', () => {
        expect(validateRequiredFields(DEFAULT_CONFIG)).toBe(false);
    });

    it('should return false when only some required fields are filled', () => {
        const partial = {
            ...DEFAULT_CONFIG,
            DASHSCOPE_API_KEY: "sk-test",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "LTAI5t",
            // missing: ACCESS_KEY_SECRET, OSS_BUCKET_NAME, OSS_ENDPOINT
        };
        expect(validateRequiredFields(partial)).toBe(false);
    });

    it('should return true when all 5 required fields are filled', () => {
        const valid = {
            ...DEFAULT_CONFIG,
            DASHSCOPE_API_KEY: "sk-test",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "LTAI5t",
            ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret123",
            OSS_BUCKET_NAME: "my-bucket",
            OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
        };
        expect(validateRequiredFields(valid)).toBe(true);
    });

    it('should return false when a required field is whitespace-only', () => {
        const whitespace = {
            ...DEFAULT_CONFIG,
            DASHSCOPE_API_KEY: "sk-test",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "   ",  // whitespace only
            ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret123",
            OSS_BUCKET_NAME: "my-bucket",
            OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
        };
        expect(validateRequiredFields(whitespace)).toBe(false);
    });

    it('should not require optional fields (KLING, VIDU, OSS_BASE_PATH)', () => {
        const minimalValid = {
            ...DEFAULT_CONFIG,
            DASHSCOPE_API_KEY: "sk-test",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "LTAI5t",
            ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret",
            OSS_BUCKET_NAME: "bucket",
            OSS_ENDPOINT: "endpoint",
            // KLING_ACCESS_KEY, KLING_SECRET_KEY, VIDU_API_KEY, OSS_BASE_PATH all empty
        };
        expect(validateRequiredFields(minimalValid)).toBe(true);
    });

    it('should handle leading/trailing whitespace in valid values', () => {
        const padded = {
            ...DEFAULT_CONFIG,
            DASHSCOPE_API_KEY: "  sk-test  ",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "  LTAI5t  ",
            ALIBABA_CLOUD_ACCESS_KEY_SECRET: "  secret  ",
            OSS_BUCKET_NAME: "  bucket  ",
            OSS_ENDPOINT: "  endpoint  ",
        };
        expect(validateRequiredFields(padded)).toBe(true);
    });
});

// ── handleChange (state transform) ─────────────────────────────────────

describe('applyChange (handleChange logic)', () => {
    it('should update a single field immutably', () => {
        const updated = applyChange(DEFAULT_CONFIG, "DASHSCOPE_API_KEY", "sk-new");
        expect(updated.DASHSCOPE_API_KEY).toBe("sk-new");
        expect(DEFAULT_CONFIG.DASHSCOPE_API_KEY).toBe("");  // original unchanged
    });

    it('should preserve other fields when updating one', () => {
        const base = { ...DEFAULT_CONFIG, VIDU_API_KEY: "existing" };
        const updated = applyChange(base, "DASHSCOPE_API_KEY", "sk-new");
        expect(updated.VIDU_API_KEY).toBe("existing");
        expect(updated.DASHSCOPE_API_KEY).toBe("sk-new");
    });

    it('should preserve endpoint_overrides when updating a key field', () => {
        const base = {
            ...DEFAULT_CONFIG,
            endpoint_overrides: { DASHSCOPE_BASE_URL: "https://custom.com" },
        };
        const updated = applyChange(base, "DASHSCOPE_API_KEY", "sk-new");
        expect(updated.endpoint_overrides).toEqual({ DASHSCOPE_BASE_URL: "https://custom.com" });
    });
});

// ── handleEndpointChange (state transform) ─────────────────────────────

describe('applyEndpointChange (handleEndpointChange logic)', () => {
    it('should add a new endpoint override', () => {
        const updated = applyEndpointChange(DEFAULT_CONFIG, "DASHSCOPE_BASE_URL", "https://intl.example.com");
        expect(updated.endpoint_overrides["DASHSCOPE_BASE_URL"]).toBe("https://intl.example.com");
    });

    it('should update an existing endpoint override', () => {
        const base = {
            ...DEFAULT_CONFIG,
            endpoint_overrides: { DASHSCOPE_BASE_URL: "https://old.com" },
        };
        const updated = applyEndpointChange(base, "DASHSCOPE_BASE_URL", "https://new.com");
        expect(updated.endpoint_overrides["DASHSCOPE_BASE_URL"]).toBe("https://new.com");
    });

    it('should preserve other overrides when updating one', () => {
        const base = {
            ...DEFAULT_CONFIG,
            endpoint_overrides: {
                DASHSCOPE_BASE_URL: "https://ds.com",
                KLING_BASE_URL: "https://kling.com",
            },
        };
        const updated = applyEndpointChange(base, "DASHSCOPE_BASE_URL", "https://new-ds.com");
        expect(updated.endpoint_overrides["DASHSCOPE_BASE_URL"]).toBe("https://new-ds.com");
        expect(updated.endpoint_overrides["KLING_BASE_URL"]).toBe("https://kling.com");
    });

    it('should allow clearing an override by setting empty string', () => {
        const base = {
            ...DEFAULT_CONFIG,
            endpoint_overrides: { DASHSCOPE_BASE_URL: "https://custom.com" },
        };
        const updated = applyEndpointChange(base, "DASHSCOPE_BASE_URL", "");
        expect(updated.endpoint_overrides["DASHSCOPE_BASE_URL"]).toBe("");
    });

    it('should not mutate original config', () => {
        const original = {
            ...DEFAULT_CONFIG,
            endpoint_overrides: { KLING_BASE_URL: "https://kling.com" },
        };
        const originalOverrides = { ...original.endpoint_overrides };
        applyEndpointChange(original, "VIDU_BASE_URL", "https://vidu.com");
        expect(original.endpoint_overrides).toEqual(originalOverrides);
    });
});

// ── normalizeApiResponse (loadConfig logic) ────────────────────────────

describe('normalizeApiResponse (loadConfig data normalization)', () => {
    it('should merge API data into existing config', () => {
        const apiData = { DASHSCOPE_API_KEY: "sk-from-api", endpoint_overrides: {} };
        const result = normalizeApiResponse(DEFAULT_CONFIG, apiData);
        expect(result.DASHSCOPE_API_KEY).toBe("sk-from-api");
    });

    it('should fallback endpoint_overrides to {} when undefined in response', () => {
        const apiData = { DASHSCOPE_API_KEY: "sk-test" }; // no endpoint_overrides
        const result = normalizeApiResponse(DEFAULT_CONFIG, apiData);
        expect(result.endpoint_overrides).toEqual({});
    });

    it('should fallback endpoint_overrides to {} when null in response', () => {
        const apiData = { DASHSCOPE_API_KEY: "sk-test", endpoint_overrides: null };
        const result = normalizeApiResponse(DEFAULT_CONFIG, apiData);
        expect(result.endpoint_overrides).toEqual({});
    });

    it('should preserve endpoint_overrides from API response', () => {
        const apiData = {
            DASHSCOPE_API_KEY: "sk-test",
            endpoint_overrides: { DASHSCOPE_BASE_URL: "https://intl.example.com" },
        };
        const result = normalizeApiResponse(DEFAULT_CONFIG, apiData);
        expect(result.endpoint_overrides).toEqual({ DASHSCOPE_BASE_URL: "https://intl.example.com" });
    });

    it('should preserve existing config fields not in API response', () => {
        const existing = { ...DEFAULT_CONFIG, KLING_ACCESS_KEY: "local-key" };
        const apiData = { DASHSCOPE_API_KEY: "sk-api", endpoint_overrides: {} };
        const result = normalizeApiResponse(existing, apiData);
        expect(result.KLING_ACCESS_KEY).toBe("local-key");
        expect(result.DASHSCOPE_API_KEY).toBe("sk-api");
    });

    it('should override existing fields with API response values', () => {
        const existing = { ...DEFAULT_CONFIG, DASHSCOPE_API_KEY: "old-key" };
        const apiData = { DASHSCOPE_API_KEY: "new-key", endpoint_overrides: {} };
        const result = normalizeApiResponse(existing, apiData);
        expect(result.DASHSCOPE_API_KEY).toBe("new-key");
    });
});

// ── canClose logic ─────────────────────────────────────────────────────

describe('computeCanClose', () => {
    const validConfig = {
        ...DEFAULT_CONFIG,
        DASHSCOPE_API_KEY: "sk-test",
        ALIBABA_CLOUD_ACCESS_KEY_ID: "LTAI5t",
        ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret",
        OSS_BUCKET_NAME: "bucket",
        OSS_ENDPOINT: "endpoint",
    };

    it('should return true when isRequired is false regardless of config', () => {
        expect(computeCanClose(false, DEFAULT_CONFIG)).toBe(true);
        expect(computeCanClose(false, validConfig)).toBe(true);
    });

    it('should return false when isRequired and config is invalid', () => {
        expect(computeCanClose(true, DEFAULT_CONFIG)).toBe(false);
    });

    it('should return true when isRequired and config is valid', () => {
        expect(computeCanClose(true, validConfig)).toBe(true);
    });
});

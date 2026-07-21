/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../SdkConfig";

const STORAGE_BRAND = "mx_org_branding_name";
const STORAGE_FAVICON = "mx_org_branding_favicon";
const STORAGE_OG_IMAGE = "mx_org_branding_og_image";

type OrgAppearanceResponse = {
    organizationName?: string;
    favicon?: string;
    logoUrl?: string;
};

function isOrgBrandingConfigured(): boolean {
    return Boolean(SdkConfig.get("branding_api_base_url") && SdkConfig.get("file_service_base_url"));
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function decodeHtmlEntities(text: string): string {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return doc.documentElement.textContent ?? text;
}

function applyFaviconHref(href: string): void {
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
        link.href = href;
    });
}

function applyOgImageHref(href: string): void {
    let meta = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
    if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("property", "og:image");
        document.head.appendChild(meta);
    }
    meta.content = href;
}

function applyBrandName(brand: string): void {
    SdkConfig.add({ brand });
    if (!document.title.includes(brand)) {
        document.title = brand;
    }
}

function applyOgImageToConfig(dataUrl: string): void {
    SdkConfig.add({
        branding: {
            ...SdkConfig.get().branding,
            og_image_url: dataUrl,
        },
    });
}

/**
 * Re-apply cached org branding after config load / SdkConfig.put.
 * No-ops when branding URLs are not configured or nothing is cached.
 */
export function restoreCachedOrgBranding(): void {
    if (!isOrgBrandingConfigured()) {
        return;
    }

    const brand = window.localStorage?.getItem(STORAGE_BRAND);
    if (brand) {
        applyBrandName(brand);
    }

    const favicon = window.localStorage?.getItem(STORAGE_FAVICON);
    if (favicon) {
        applyFaviconHref(favicon);
    }

    const ogImage = window.localStorage?.getItem(STORAGE_OG_IMAGE);
    if (ogImage) {
        applyOgImageHref(ogImage);
        applyOgImageToConfig(ogImage);
    }
}

/**
 * Clear cached org branding (logout also clears localStorage entirely).
 */
export function clearCachedOrgBranding(): void {
    window.localStorage?.removeItem(STORAGE_BRAND);
    window.localStorage?.removeItem(STORAGE_FAVICON);
    window.localStorage?.removeItem(STORAGE_OG_IMAGE);
}

/**
 * Fetch org appearance on first JWT login and apply title, favicon, and og:image.
 * On any failure or missing fields, leaves default config branding in place.
 */
export async function fetchAndApplyOrgBranding(jwt: string, organizationId: string): Promise<void> {
    if (!isOrgBrandingConfigured()) {
        return;
    }

    const brandingBase = SdkConfig.get("branding_api_base_url");
    const fileBase = SdkConfig.get("file_service_base_url");
    if (!brandingBase || !fileBase || !organizationId || !jwt) {
        return;
    }

    try {
        const appearanceUrl = joinUrl(brandingBase, `organization/${encodeURIComponent(organizationId)}/appearance`);
        const response = await fetch(appearanceUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/json",
            },
        });

        if (!response.ok) {
            logger.warn("Org branding appearance request failed", response.status);
            return;
        }

        const data = (await response.json()) as OrgAppearanceResponse;

        if (data.organizationName) {
            const brand = decodeHtmlEntities(data.organizationName).trim();
            if (brand) {
                applyBrandName(brand);
                window.localStorage?.setItem(STORAGE_BRAND, brand);
            }
        }

        if (data.favicon) {
            const dataUrl = await downloadBrandingFile(fileBase, data.favicon, jwt);
            if (dataUrl) {
                applyFaviconHref(dataUrl);
                window.localStorage?.setItem(STORAGE_FAVICON, dataUrl);
            }
        }

        if (data.logoUrl) {
            const dataUrl = await downloadBrandingFile(fileBase, data.logoUrl, jwt);
            if (dataUrl) {
                applyOgImageHref(dataUrl);
                applyOgImageToConfig(dataUrl);
                window.localStorage?.setItem(STORAGE_OG_IMAGE, dataUrl);
            }
        }
    } catch (error) {
        logger.error("Failed to apply org branding", error);
    }
}

async function downloadBrandingFile(fileBase: string, filePath: string, jwt: string): Promise<string | null> {
    try {
        const fileUrl = joinUrl(fileBase, filePath);
        const fileResponse = await fetch(fileUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${jwt}`,
            },
        });

        if (!fileResponse.ok) {
            logger.warn("Org branding file download failed", filePath, fileResponse.status);
            return null;
        }

        const blob = await fileResponse.blob();
        return await blobToDataUrl(blob);
    } catch (error) {
        logger.warn("Org branding file download error", filePath, error);
        return null;
    }
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read branding file blob"));
        reader.readAsDataURL(blob);
    });
}

/** Resolve organization id from a decoded JWT payload. */
export function getOrganizationIdFromJwtPayload(payload: Record<string, unknown> | null | undefined): string | undefined {
    if (!payload) return undefined;

    const direct =
        (payload.organization_id as string | undefined) ??
        (payload.organizationId as string | undefined) ??
        (payload.org_id as string | undefined);
    if (typeof direct === "string" && direct.length > 0) {
        return direct;
    }

    const data = payload.data;
    if (data && typeof data === "object") {
        const nested = data as Record<string, unknown>;
        const fromData =
            (nested.organization_id as string | undefined) ??
            (nested.organizationId as string | undefined) ??
            (nested.org_id as string | undefined);
        if (typeof fromData === "string" && fromData.length > 0) {
            return fromData;
        }
    }

    return undefined;
}

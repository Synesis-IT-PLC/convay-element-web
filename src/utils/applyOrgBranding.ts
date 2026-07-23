/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../SdkConfig";
import dis from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { parseQsFromFragment } from "../vector/url_utils";

const STORAGE_JWT = "mx_org_branding_jwt";
const STORAGE_ORG_ID = "mx_org_branding_org_id";

type OrgAppearanceResponse = {
    organizationName?: string;
    favicon?: string;
    logoUrl?: string;
};

let inFlightRefresh: Promise<void> | null = null;

function isOrgBrandingConfigured(): boolean {
    return Boolean(SdkConfig.get("branding_api_base_url") && SdkConfig.get("file_service_base_url"));
}

function hasStoredMatrixSession(): boolean {
    if (!window.localStorage) {
        return false;
    }
    const userId = window.localStorage.getItem("mx_user_id");
    const hasAccessToken =
        window.localStorage.getItem("mx_has_access_token") === "true" ||
        Boolean(window.localStorage.getItem("mx_access_token"));
    return Boolean(userId && hasAccessToken);
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
    document.title = brand;
}

const DEFAULT_LOGO_PATH = "vector-icons/520.png";

function toAbsoluteUrl(path: string): string {
    if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
        return path;
    }
    return new URL(path, window.location.origin).href;
}

function applyLogoToConfig(logoUrl: string, ogImageUrl: string = logoUrl): void {
    SdkConfig.add({
        branding: {
            ...SdkConfig.get().branding,
            auth_header_logo_url: logoUrl,
            og_image_url: ogImageUrl,
        },
    });
}

/** Restore logo + og:image from config.json branding defaults. */
function applyDefaultLogoFromConfig(): void {
    const branding = SdkConfig.get().branding;
    let logoUrl = branding?.auth_header_logo_url ?? branding?.og_image_url ?? DEFAULT_LOGO_PATH;
    let ogImageUrl = branding?.og_image_url ?? logoUrl;

    // If SdkConfig was previously overwritten with a fetched data URL, restore the static default
    if (logoUrl.startsWith("data:")) {
        logoUrl = DEFAULT_LOGO_PATH;
    }
    if (ogImageUrl.startsWith("data:")) {
        ogImageUrl = DEFAULT_LOGO_PATH;
    }

    applyLogoToConfig(logoUrl, ogImageUrl);
    applyOgImageHref(toAbsoluteUrl(ogImageUrl));
    logger.debug("Using default logo from config", { logoUrl, ogImageUrl });
}

function notifyOrgBrandingUpdated(): void {
    dis.dispatch({ action: Action.OrgBrandingUpdated });
}

function readOrgIdFromRecord(record: Record<string, unknown>): string | undefined {
    const candidates = [record.organization_id, record.organizationId, record.org_id, record.id];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
        if (typeof candidate === "number") {
            return String(candidate);
        }
    }
    return undefined;
}

/**
 * Clear stored branding API credentials.
 */
export function clearOrgBrandingCredentials(): void {
    window.localStorage?.removeItem(STORAGE_JWT);
    window.localStorage?.removeItem(STORAGE_ORG_ID);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");

    try {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Fetch org branding when a JWT is present in the URL fragment (e.g. welcome page before login).
 */
export async function refreshOrgBrandingFromFragment(location: Location = window.location): Promise<void> {
    const { params } = parseQsFromFragment(location);
    const jwt = params.jwt;
    if (typeof jwt !== "string" || !jwt) {
        return;
    }

    const payload = decodeJwtPayload(jwt);
    const organizationId = getOrganizationIdFromJwtPayload(payload);
    await refreshOrgBranding(jwt, organizationId);
}

/**
 * Fetch org branding as early as possible on page load when a session exists.
 */
export async function maybeRefreshOrgBrandingOnLoad(): Promise<void> {
    if (!isOrgBrandingConfigured()) {
        return;
    }
    if (!hasStoredMatrixSession()) {
        logger.debug("Org branding refresh skipped on load: no stored matrix session");
        return;
    }
    await refreshOrgBranding();
}

/**
 * Re-fetch org appearance from the API (page reload / session restore).
 * Pass explicit jwt/organizationId when available (e.g. from URL fragment on re-entry).
 */
export async function refreshOrgBranding(jwt?: string, organizationId?: string): Promise<void> {
    if (!isOrgBrandingConfigured()) {
        logger.debug("Org branding refresh skipped: branding API URLs not configured");
        return;
    }

    const storedJwt = jwt ?? window.localStorage?.getItem(STORAGE_JWT);
    const storedOrgId = organizationId ?? window.localStorage?.getItem(STORAGE_ORG_ID);
    if (!storedJwt || !storedOrgId) {
        logger.warn("Org branding refresh skipped: missing JWT or organization id in storage");
        return;
    }

    if (!inFlightRefresh) {
        inFlightRefresh = fetchAndApplyOrgBranding(storedJwt, storedOrgId).finally(() => {
            inFlightRefresh = null;
        });
    }
    await inFlightRefresh;
}

/**
 * Fetch org appearance and apply title, favicon, header logo, and og:image.
 * On any failure or missing fields, leaves default config branding in place.
 */
export async function fetchAndApplyOrgBranding(jwt: string, organizationId: string): Promise<void> {
    if (!isOrgBrandingConfigured()) {
        return;
    }

    const brandingBase = SdkConfig.get("branding_api_base_url");
    const fileBase = SdkConfig.get("file_service_base_url");
    if (!brandingBase || !fileBase || !organizationId || !jwt) {
        logger.warn("Org branding fetch skipped: missing configuration or credentials");
        return;
    }

    window.localStorage?.setItem(STORAGE_JWT, jwt);
    window.localStorage?.setItem(STORAGE_ORG_ID, organizationId);

    try {
        const appearanceUrl = joinUrl(brandingBase, `organization/${encodeURIComponent(organizationId)}/appearance`);
        logger.log("Fetching org branding from", appearanceUrl);
        const response = await fetch(appearanceUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/json",
            },
        });

        if (!response.ok) {
            logger.warn("Org branding appearance request failed", response.status, appearanceUrl);
            applyDefaultLogoFromConfig();
            notifyOrgBrandingUpdated();
            return;
        }

        const data = (await response.json()) as OrgAppearanceResponse;
        let applied = false;

        if (data.organizationName) {
            const brand = decodeHtmlEntities(data.organizationName).trim();
            if (brand) {
                applyBrandName(brand);
                applied = true;
            }
        }

        if (data.favicon) {
            const dataUrl = await downloadBrandingFile(fileBase, data.favicon, jwt);
            if (dataUrl) {
                applyFaviconHref(dataUrl);
                applied = true;
            }
        }

        if (data.logoUrl) {
            const dataUrl = await downloadBrandingFile(fileBase, data.logoUrl, jwt);
            if (dataUrl) {
                applyOgImageHref(dataUrl);
                applyLogoToConfig(dataUrl);
                applied = true;
            } else {
                logger.warn("Org logo download failed, falling back to config default");
                applyDefaultLogoFromConfig();
                applied = true;
            }
        } else {
            logger.debug("No logoUrl in appearance response, using config default");
            applyDefaultLogoFromConfig();
            applied = true;
        }

        if (applied) {
            logger.log("Org branding applied", { brand: SdkConfig.get().brand });
            notifyOrgBrandingUpdated();
        } else {
            logger.warn("Org branding API returned no usable fields", data);
        }
    } catch (error) {
        logger.error("Failed to apply org branding", error);
        applyDefaultLogoFromConfig();
        notifyOrgBrandingUpdated();
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

    const direct = readOrgIdFromRecord(payload);
    if (direct) return direct;

    const data = payload.data;
    if (data && typeof data === "object") {
        const fromData = readOrgIdFromRecord(data as Record<string, unknown>);
        if (fromData) return fromData;
    }

    const org = payload.organization ?? payload.org;
    if (org && typeof org === "object") {
        const fromOrg = readOrgIdFromRecord(org as Record<string, unknown>);
        if (fromOrg) return fromOrg;
    }

    return undefined;
}

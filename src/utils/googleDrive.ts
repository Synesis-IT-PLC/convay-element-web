/*
 * Copyright 2025 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
 * Please see LICENSE files in the repository root for full details.
 */

import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../SdkConfig";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

type TokenClient = {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type TokenResponse = {
    access_token?: string;
    error?: string;
    error_description?: string;
};

declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        callback: (response: TokenResponse) => void;
                        error_callback?: (error: { type?: string; message?: string }) => void;
                    }) => TokenClient;
                };
            };
        };
    }
}

let gisScriptPromise: Promise<void> | null = null;

export class GoogleDriveRecoveryKeyNotFoundError extends Error {
    public constructor() {
        super("No recovery key file found in Google Drive");
        this.name = "GoogleDriveRecoveryKeyNotFoundError";
    }
}

/**
 * Build a safe download/upload filename for the recovery key.
 * Example: recovery-key-alice.txt
 */
export function getRecoveryKeyFilename(userId: string | null): string {
    const localpart = userId?.replace(/^@/, "").split(":")[0] || "user";
    const safeUsername = localpart.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `recovery-key-${safeUsername}.txt`;
}

/**
 * Returns the configured Google OAuth client ID, or undefined if Drive save is not configured.
 */
export function getGoogleDriveClientId(): string | undefined {
    const clientId = SdkConfig.get("google_drive")?.client_id?.trim();
    return clientId || undefined;
}

function loadGoogleIdentityServices(): Promise<void> {
    if (window.google?.accounts?.oauth2) {
        return Promise.resolve();
    }
    if (gisScriptPromise) {
        return gisScriptPromise;
    }

    gisScriptPromise = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")), {
                once: true,
            });
            // Script may already be loaded
            if (window.google?.accounts?.oauth2) {
                resolve();
            }
            return;
        }

        const script = document.createElement("script");
        script.src = GIS_SCRIPT_SRC;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            gisScriptPromise = null;
            reject(new Error("Failed to load Google Identity Services"));
        };
        document.head.appendChild(script);
    });

    return gisScriptPromise;
}

function requestAccessToken(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const tokenClient = window.google!.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_FILE_SCOPE,
            callback: (response) => {
                if (response.error || !response.access_token) {
                    reject(
                        new Error(
                            response.error_description || response.error || "Google authorization was cancelled",
                        ),
                    );
                    return;
                }
                resolve(response.access_token);
            },
            error_callback: (error) => {
                reject(new Error(error.message || error.type || "Google authorization failed"));
            },
        });

        // Empty prompt reuses consent when possible; "consent" forces the account chooser.
        tokenClient.requestAccessToken({ prompt: "" });
    });
}

async function ensureAccessToken(): Promise<string> {
    const clientId = getGoogleDriveClientId();
    if (!clientId) {
        throw new Error("Google Drive is not configured");
    }

    await loadGoogleIdentityServices();
    return requestAccessToken(clientId);
}

async function uploadTextFile(accessToken: string, filename: string, content: string): Promise<void> {
    const metadata = {
        name: filename,
        mimeType: "text/plain",
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([content], { type: "text/plain" }));

    const response = await fetch(DRIVE_UPLOAD_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        body: form,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        logger.error("Google Drive upload failed", response.status, body);
        throw new Error("Failed to upload recovery key to Google Drive");
    }
}

async function findRecoveryKeyFileId(accessToken: string, filename: string): Promise<string> {
    // Escape single quotes in the Drive query language.
    const safeName = filename.replace(/'/g, "\\'");
    const query = `name='${safeName}' and trashed=false`;
    const params = new URLSearchParams({
        q: query,
        spaces: "drive",
        fields: "files(id,name,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: "1",
    });

    const response = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        logger.error("Google Drive file list failed", response.status, body);
        throw new Error("Failed to search Google Drive for recovery key");
    }

    const data = (await response.json()) as { files?: Array<{ id: string }> };
    const fileId = data.files?.[0]?.id;
    if (!fileId) {
        throw new GoogleDriveRecoveryKeyNotFoundError();
    }
    return fileId;
}

async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        logger.error("Google Drive download failed", response.status, body);
        throw new Error("Failed to download recovery key from Google Drive");
    }

    return (await response.text()).trim();
}

/**
 * Authenticate with Google (drive.file scope) and upload the recovery key as a text file.
 */
export async function saveRecoveryKeyToGoogleDrive(recoveryKey: string, filename: string): Promise<void> {
    const accessToken = await ensureAccessToken();
    await uploadTextFile(accessToken, filename, recoveryKey);
}

/**
 * Authenticate with Google and download the recovery key previously saved by this app.
 */
export async function restoreRecoveryKeyFromGoogleDrive(filename: string): Promise<string> {
    const accessToken = await ensureAccessToken();
    const fileId = await findRecoveryKeyFileId(accessToken, filename);
    const recoveryKey = await downloadTextFile(accessToken, fileId);
    if (!recoveryKey) {
        throw new Error("Recovery key file from Google Drive was empty");
    }
    return recoveryKey;
}

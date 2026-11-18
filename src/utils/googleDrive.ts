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

/**
 * Authenticate with Google (drive.file scope) and upload the recovery key as a text file.
 */
export async function saveRecoveryKeyToGoogleDrive(recoveryKey: string, filename: string): Promise<void> {
    const clientId = getGoogleDriveClientId();
    if (!clientId) {
        throw new Error("Google Drive is not configured");
    }

    await loadGoogleIdentityServices();
    const accessToken = await requestAccessToken(clientId);
    await uploadTextFile(accessToken, filename, recoveryKey);
}

/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../SdkConfig";

type LoginApiResponse = {
    accessToken?: string;
};

/**
 * Validates email/password credentials against the configured login_api endpoint.
 * Returns true when login_api is not configured (Synapse-only flow).
 */
export async function authenticateViaLoginApi(email: string, password: string): Promise<boolean> {
    const loginApi = SdkConfig.get("login_api");
    console.log("[login_api] endpoint:", loginApi, "| email:", email);
    if (!loginApi) {
        return true;
    }

    try {
        const response = await fetch(loginApi, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        console.log("[login_api] status:", response.status, response.statusText);

        if (!response.ok) {
            console.warn("[login_api] non-200 response → validation failed");
            return false;
        }

        const data = (await response.json()) as LoginApiResponse;
        console.log("[login_api] body:", data, "| accessToken present:", Boolean(data.accessToken));
        return Boolean(data.accessToken);
    } catch (error) {
        console.error("[login_api] request error:", error);
        logger.error("Custom login_api authentication failed", error);
        return false;
    }
}

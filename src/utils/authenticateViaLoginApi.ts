/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../SdkConfig";
import { decodeJwtPayload, fetchAndApplyOrgBranding, getOrganizationIdFromJwtPayload } from "./applyOrgBranding";

type LoginApiResponse = {
    accessToken?: string;
};

export type LoginApiResult = {
    ok: boolean;
    accessToken?: string;
};

type PendingLoginApiSession = {
    email: string;
    accessToken?: string;
};

let pendingSession: PendingLoginApiSession | null = null;

/**
 * Calls the configured login_api endpoint with email/password credentials.
 * Returns ok=true when login_api is not configured (Synapse-only flow).
 */
export async function loginViaLoginApi(email: string, password: string): Promise<LoginApiResult> {
    const loginApi = SdkConfig.get("login_api");
    console.log("[login_api] endpoint:", loginApi, "| email:", email);
    if (!loginApi) {
        return { ok: true };
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
            return { ok: false };
        }

        const data = (await response.json()) as LoginApiResponse;
        console.log("[login_api] accessToken present:", Boolean(data.accessToken));
        return { ok: Boolean(data.accessToken), accessToken: data.accessToken };
    } catch (error) {
        console.error("[login_api] request error:", error);
        logger.error("Custom login_api authentication failed", error);
        return { ok: false };
    }
}

/**
 * Validates email/password credentials against the configured login_api endpoint.
 * Returns true when login_api is not configured (Synapse-only flow).
 */
export async function authenticateViaLoginApi(email: string, password: string): Promise<boolean> {
    const { ok } = await loginViaLoginApi(email, password);
    return ok;
}

/**
 * Remember login_api results until the Matrix session has been persisted,
 * since setLoggedIn clears localStorage before storing the new session.
 */
export function setPendingLoginApiSession(session: PendingLoginApiSession): void {
    pendingSession = session;
}

export function clearPendingLoginApiSession(): void {
    pendingSession = null;
}

/**
 * Matrix usernames are created from the email with "@" replaced by "at",
 * e.g. @moon.map9390ateagereverest.com:server -> moon.map9390@eagereverest.com.
 * The last "at" is used since the domain part rarely contains it.
 */
export function emailFromMatrixUserId(userId: string | null | undefined): string | undefined {
    if (!userId) return undefined;
    const localpart = userId.replace(/^@/, "").split(":")[0];
    const index = localpart.lastIndexOf("at");
    if (index <= 0 || index + 2 >= localpart.length) return undefined;
    return `${localpart.slice(0, index)}@${localpart.slice(index + 2)}`;
}

/**
 * Persist the user email and org branding credentials obtained from login_api,
 * mirroring what the /jwt login flow stores. Must run after setLoggedIn and
 * before post-login steps (identity reset / device verification) that need the email.
 */
export function applyPendingLoginApiSession(client: MatrixClient): void {
    const session = pendingSession;
    pendingSession = null;

    if (!session) {
        const email = emailFromMatrixUserId(client.getUserId());
        console.log("[login_api] user email derived from username:", email);
        if (email) localStorage.setItem("mx_user_email", email);
        return;
    }

    localStorage.setItem("mx_user_email", session.email);
    console.log("[login_api] persisted user email:", session.email);

    if (!session.accessToken) return;

    const organizationId = getOrganizationIdFromJwtPayload(decodeJwtPayload(session.accessToken));
    if (!organizationId) {
        logger.warn("login_api: no organization id in token payload, org branding will not be applied");
        return;
    }
    void fetchAndApplyOrgBranding(session.accessToken, organizationId);
}

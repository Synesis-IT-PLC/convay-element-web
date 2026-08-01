/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { initializeApp, type FirebaseApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, type Auth } from "firebase/auth";
import {
    getDatabase,
    ref,
    onValue,
    type Database,
    type Unsubscribe,
    type DataSnapshot,
} from "firebase/database";
import { logger } from "matrix-js-sdk/src/logger";

import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { type ActionPayload } from "../dispatcher/payloads";

const LOG_PREFIX = "[FirebaseRemoteLogout]";

type LogoutEventPayload = {
    loggedOut?: boolean;
    timestamp?: number;
    [key: string]: unknown;
};

let app: FirebaseApp | null = null;
let database: Database | null = null;
let auth: Auth | null = null;
let unsubscribeSnapshot: Unsubscribe | null = null;
let dispatcherRef: string | null = null;
let startedForEmail: string | null = null;

function sanitizeEmail(email: string): string {
    // Firebase RTDB keys cannot contain . # $ [ ] /
    return email.trim().toLowerCase().replace(/[.#$[\]/]/g, "_");
}

function readFirebaseConfig(): Record<string, string> | null {
    const apiKey = process.env.FIREBASE_API_KEY;
    const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
    const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID;
    const appId = process.env.FIREBASE_APP_ID;
    const measurementId = process.env.FIREBASE_MEASUREMENT_ID;

    if (!apiKey || !databaseURL || !projectId || !appId) {
        console.warn(LOG_PREFIX, "Missing Firebase env config — listener not started");
        return null;
    }

    return {
        apiKey,
        authDomain: authDomain ?? "",
        databaseURL,
        projectId,
        storageBucket: storageBucket ?? "",
        messagingSenderId: messagingSenderId ?? "",
        appId,
        ...(measurementId ? { measurementId } : {}),
    };
}

function resolveUserEmail(): string | null {
    if (!window.localStorage) {
        return null;
    }
    const stored = window.localStorage.getItem("mx_user_email");
    return stored?.trim() || null;
}

async function ensureFirebase(): Promise<boolean> {
    if (database) {
        return true;
    }

    const config = readFirebaseConfig();
    if (!config) {
        return false;
    }

    app = getApps().length ? getApps()[0]! : initializeApp(config);
    database = getDatabase(app);
    auth = getAuth(app);

    const authEmail = process.env.FIREBASE_AUTH_EMAIL;
    const authPassword = process.env.FIREBASE_AUTH_PASSWORD;
    if (authEmail && authPassword && auth) {
        try {
            await signInWithEmailAndPassword(auth, authEmail, authPassword);
            console.log(LOG_PREFIX, "Signed in to Firebase Auth as", authEmail);
        } catch (err) {
            console.warn(LOG_PREFIX, "Firebase Auth sign-in failed (continuing anyway)", err);
            logger.warn("Firebase Auth sign-in failed", err);
        }
    }

    console.log(LOG_PREFIX, "Firebase initialized for project", config.projectId);
    return true;
}

function stopListening(): void {
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
        console.log(LOG_PREFIX, "Unsubscribed from logout events for", startedForEmail);
    }
    startedForEmail = null;
}

async function startListening(): Promise<void> {
    const email = resolveUserEmail();
    if (!email) {
        console.warn(LOG_PREFIX, "No mx_user_email in localStorage — cannot subscribe");
        return;
    }

    if (startedForEmail === email && unsubscribeSnapshot) {
        console.log(LOG_PREFIX, "Already listening for", email);
        return;
    }

    stopListening();

    const ready = await ensureFirebase();
    if (!ready || !database) {
        return;
    }

    const sanitized = sanitizeEmail(email);
    const path = `logout_events/${sanitized}`;
    const logoutRef = ref(database, path);

    console.log(LOG_PREFIX, "Subscribing to", path, "(email:", email + ")");

    startedForEmail = email;
    unsubscribeSnapshot = onValue(
        logoutRef,
        (snapshot: DataSnapshot) => {
            const data = snapshot.val() as LogoutEventPayload | null;
            console.log(LOG_PREFIX, "Snapshot received at", path, "→", data);

            if (data && data.loggedOut === true) {
                const ts = data.timestamp;
                if (typeof ts === "number" && Date.now() - ts > 30_000) {
                    console.log(LOG_PREFIX, "Ignoring stale logout event (age ms:", Date.now() - ts + ")");
                    return;
                }
                console.log(LOG_PREFIX, "Valid logout event detected (listen-only — no action yet)", data);
            }
        },
        (error: Error) => {
            console.error(LOG_PREFIX, "Listener error on", path, error);
        },
    );
}

function onAction(payload: ActionPayload): void {
    switch (payload.action) {
        case Action.ClientStarted:
            void startListening();
            break;
        case Action.OnLoggedOut:
            stopListening();
            break;
    }
}

/**
 * Register dispatcher hooks so we subscribe after login and unsubscribe on logout.
 * Call once during app init.
 */
export function initFirebaseRemoteLogout(): void {
    if (dispatcherRef) {
        return;
    }
    dispatcherRef = defaultDispatcher.register(onAction);
    console.log(LOG_PREFIX, "Dispatcher hooks registered");

    // If a session is already restored, ClientStarted may have already fired —
    // try starting when email is already present.
    if (resolveUserEmail()) {
        void startListening();
    }
}

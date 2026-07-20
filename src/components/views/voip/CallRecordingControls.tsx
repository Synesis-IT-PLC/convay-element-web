/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type FC, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { StopSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import type { Call } from "../../../models/Call";
import { ConnectionState } from "../../../models/Call";
import { useConnectionState } from "../../../hooks/useCall";
import { CallTabRecorder } from "../../../voip/CallTabRecorder";
import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";

const logger = rootLogger.getChild("voip.CallRecordingControls");

const HOST_ATTR = "data-mx-call-recording-host";
const STYLE_ATTR = "data-mx-call-recording-style";

const THEME_ATTR = "data-mx-theme";

const IFRAME_BUTTON_STYLES = `
[${HOST_ATTR}] {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 2147483646;
    pointer-events: auto;
    width: auto;
    height: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}
.mx_CallView_recordingButton {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border: none;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.92);
    color: #1b1d22;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    padding: 0;
}
.mx_CallView_recordingButton:hover {
    filter: brightness(0.96);
}
.mx_CallView_recordingButton.mx_CallView_recordingButton_active {
    background-color: rgba(255, 255, 255, 0.92);
    color: #ff4b55;
}
.mx_CallView_recordingButton_dot {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background-color: #ff4b55;
}
.mx_CallView_recordingButton svg {
    width: 20px;
    height: 20px;
}
.mx_CallView_recordingLabel {
    font-size: 12px;
    line-height: 1.2;
    font-weight: 600;
    color: #1b1d22;
    text-shadow: 0 0 4px rgba(255, 255, 255, 0.9);
    user-select: none;
    pointer-events: none;
}
[${HOST_ATTR}]:has(.mx_CallView_recordingButton_active) .mx_CallView_recordingLabel {
    color: #ff4b55;
}
[${HOST_ATTR}][${THEME_ATTR}="dark"] .mx_CallView_recordingButton {
    background-color: rgba(40, 40, 45, 0.9);
    color: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
[${HOST_ATTR}][${THEME_ATTR}="dark"] .mx_CallView_recordingButton:hover {
    filter: brightness(1.12);
}
[${HOST_ATTR}][${THEME_ATTR}="dark"] .mx_CallView_recordingButton.mx_CallView_recordingButton_active {
    background-color: rgba(0, 0, 0, 0.75);
    color: #ff4b55;
}
[${HOST_ATTR}][${THEME_ATTR}="dark"] .mx_CallView_recordingLabel {
    color: #f0f0f0;
    text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}
`;

interface CallRecordingControlsProps {
    call: Call;
}

function isParentDarkTheme(): boolean {
    return (
        document.body.classList.contains("cpd-theme-dark") || document.body.classList.contains("cpd-theme-dark-hc")
    );
}

function syncHostTheme(host: HTMLElement): void {
    host.setAttribute(THEME_ATTR, isParentDarkTheme() ? "dark" : "light");
}

function findElementCallIframe(): HTMLIFrameElement | null {
    const iframes = Array.from(document.querySelectorAll("iframe"));
    return (
        iframes.find((iframe) => {
            const src = iframe.src || "";
            return src.includes("element-call") || src.includes("widgets/element-call");
        }) ??
        iframes.find((iframe) => {
            try {
                return Boolean(iframe.contentDocument?.querySelector('[data-testid="footer-container"]'));
            } catch {
                return false;
            }
        }) ??
        null
    );
}

function ensureIframeStyles(doc: Document): void {
    let style = doc.querySelector<HTMLStyleElement>(`[${STYLE_ATTR}]`);
    if (!style) {
        style = doc.createElement("style");
        style.setAttribute(STYLE_ATTR, "true");
        doc.head.appendChild(style);
    }
    style.textContent = IFRAME_BUTTON_STYLES;
}

function ensureHostInIframe(doc: Document): HTMLElement | null {
    const existing = doc.querySelector<HTMLElement>(`[${HOST_ATTR}]`);
    if (existing?.isConnected) {
        syncHostTheme(existing);
        return existing;
    }
    if (!doc.body) return null;

    ensureIframeStyles(doc);
    const host = doc.createElement("div");
    host.setAttribute(HOST_ATTR, "true");
    host.className = "mx_CallView_recordingControls";
    syncHostTheme(host);
    doc.body.appendChild(host);
    return host;
}

/**
 * Record control for Element Call.
 * Mounted inside the EC iframe at a fixed top-left so it stays within the call
 * widget at every window size (parent PersistedElement overlays can drift).
 */
export const CallRecordingControls: FC<CallRecordingControlsProps> = ({ call }) => {
    const connectionState = useConnectionState(call);
    const [recording, setRecording] = useState(false);
    const [host, setHost] = useState<HTMLElement | null>(null);
    const recorderRef = useRef<CallTabRecorder | null>(null);

    useEffect(() => {
        const recorder = new CallTabRecorder();
        recorder.setRecordingChangeListener(setRecording);
        recorderRef.current = recorder;
        return () => {
            recorder.dispose();
            recorderRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (connectionState !== ConnectionState.Connected && recording) {
            recorderRef.current?.stop();
        }
    }, [connectionState, recording]);

    useEffect(() => {
        if (connectionState !== ConnectionState.Connected) {
            setHost(null);
            return;
        }

        let cancelled = false;
        let intervalId: number | undefined;

        const tryAttach = (): void => {
            if (cancelled) return;
            const iframe = findElementCallIframe();
            const doc = iframe?.contentDocument;
            if (!doc) return;

            const nextHost = ensureHostInIframe(doc);
            if (nextHost) {
                setHost((prev) => (prev === nextHost ? prev : nextHost));
            }
        };

        tryAttach();
        intervalId = window.setInterval(tryAttach, 500);

        return () => {
            cancelled = true;
            if (intervalId !== undefined) window.clearInterval(intervalId);
            const doc = findElementCallIframe()?.contentDocument;
            doc?.querySelector(`[${HOST_ATTR}]`)?.remove();
            doc?.querySelector(`[${STYLE_ATTR}]`)?.remove();
            setHost(null);
        };
    }, [connectionState]);

    const onClick = useCallback(async (): Promise<void> => {
        const recorder = recorderRef.current;
        if (!recorder) return;

        try {
            if (recorder.isRecording) {
                recorder.stop();
            } else {
                await recorder.start();
            }
        } catch (error) {
            logger.error("Call recording failed", error);
            Modal.createDialog(ErrorDialog, {
                title: _t("voip|call_recording_failed_title"),
                description: _t("voip|call_recording_failed_description"),
            });
        }
    }, []);

    if (connectionState !== ConnectionState.Connected || !host) {
        return null;
    }

    const ariaLabel = recording ? _t("voip|stop_call_recording") : _t("voip|start_call_recording");
    const visibleLabel = recording ? _t("action|stop") : _t("voip|record");

    return createPortal(
        <>
            <button
                type="button"
                className={classNames("mx_CallView_recordingButton", {
                    mx_CallView_recordingButton_active: recording,
                })}
                onClick={onClick}
                title={ariaLabel}
                aria-label={ariaLabel}
                aria-pressed={recording}
            >
                {recording ? <StopSolidIcon /> : <span className="mx_CallView_recordingButton_dot" />}
            </button>
            <span className="mx_CallView_recordingLabel">{visibleLabel}</span>
        </>,
        host,
    );
};

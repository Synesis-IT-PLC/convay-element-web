/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { saveAs } from "file-saver";

const logger = rootLogger.getChild("voip.CallTabRecorder");

function pickMimeType(): string {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const candidate of candidates) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }
    return "";
}

function isUserCancellation(error: unknown): boolean {
    return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}

/**
 * Records the current browser tab (video + tab audio when available) via
 * getDisplayMedia + MediaRecorder, then downloads a WebM file.
 *
 * Intended for Element Call, where call media lives in an iframe and is not
 * directly accessible to the parent app.
 */
export class CallTabRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private chunks: Blob[] = [];
    private mimeType = "";
    private onRecordingChange: ((recording: boolean) => void) | null = null;

    public setRecordingChangeListener(listener: ((recording: boolean) => void) | null): void {
        this.onRecordingChange = listener;
    }

    public get isRecording(): boolean {
        return this.mediaRecorder?.state === "recording";
    }

    public async start(): Promise<void> {
        if (this.mediaRecorder) {
            throw new Error("Recording already in progress");
        }

        // Chromium-oriented hints so the picker prefers this tab + tab audio.
        const displayMediaOptions = {
            video: { displaySurface: "browser" },
            audio: true,
            preferCurrentTab: true,
            selfBrowserSurface: "include",
            systemAudio: "exclude",
            surfaceSwitching: "exclude",
            monitorTypeSurfaces: "exclude",
        } as DisplayMediaStreamOptions;

        try {
            this.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } catch (error) {
            if (isUserCancellation(error)) {
                logger.info("Call tab recording cancelled by user");
                return;
            }
            throw error;
        }

        try {
            this.mimeType = pickMimeType();
            this.chunks = [];
            this.mediaRecorder = this.mimeType
                ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
                : new MediaRecorder(this.stream);

            this.mediaRecorder.ondataavailable = (event: BlobEvent): void => {
                if (event.data.size > 0) {
                    this.chunks.push(event.data);
                }
            };
            this.mediaRecorder.onstop = (): void => {
                this.finishAndDownload();
            };

            this.stream.getVideoTracks()[0]?.addEventListener("ended", this.onCaptureEnded);
            this.mediaRecorder.start(1000);
            this.onRecordingChange?.(true);
        } catch (error) {
            this.cleanup();
            throw error;
        }
    }

    public stop(): void {
        const recorder = this.mediaRecorder;
        if (!recorder || recorder.state === "inactive") {
            this.cleanup();
            return;
        }
        recorder.stop();
    }

    public dispose(): void {
        if (this.mediaRecorder?.state === "recording") {
            this.stop();
        } else {
            this.cleanup();
        }
    }

    private readonly onCaptureEnded = (): void => {
        this.stop();
    };

    private finishAndDownload(): void {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/webm" });
        this.cleanup();
        if (blob.size === 0) {
            logger.warn("Call tab recording produced an empty blob");
            return;
        }
        const filename = `call-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        saveAs(blob, filename);
    }

    private cleanup(): void {
        this.stream?.getVideoTracks()[0]?.removeEventListener("ended", this.onCaptureEnded);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
        this.mimeType = "";
        this.onRecordingChange?.(false);
    }
}

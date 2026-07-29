/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type FC, useCallback, useContext, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { IconButton, Tooltip } from "@vector-im/compound-web";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import {
    ListViewIcon,
    SpotlightViewIcon,
    StopSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import type { Call } from "../../../models/Call";
import { ConnectionState } from "../../../models/Call";
import { useConnectionState } from "../../../hooks/useCall";
import { CallTabRecorder } from "../../../voip/CallTabRecorder";
import { sendCallRecordingNotice } from "../../../voip/sendCallRecordingNotice";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";

const logger = rootLogger.getChild("voip.CallRecordingControls");

interface CallRecordingControlsProps {
    call: Call;
}

/**
 * Record control for Element Call, shown in the room header while connected.
 */
export const CallRecordingControls: FC<CallRecordingControlsProps> = ({ call }) => {
    const cli = useContext(MatrixClientContext);
    const connectionState = useConnectionState(call);
    const [recording, setRecording] = useState(false);
    const [sidebarHidden, setSidebarHidden] = useState(true);
    const recorderRef = useRef<CallTabRecorder | null>(null);
    const prevRecordingRef = useRef(false);

    useEffect(() => {
        const recorder = new CallTabRecorder();
        recorder.setRecordingChangeListener(setRecording);
        recorder.setSidebarHiddenChangeListener(setSidebarHidden);
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
        if (!recording) {
            setSidebarHidden(true);
        }
    }, [recording]);

    useEffect(() => {
        const wasRecording = prevRecordingRef.current;
        if (wasRecording === recording) {
            return;
        }
        prevRecordingRef.current = recording;
        void sendCallRecordingNotice(cli, call.roomId, recording);
    }, [recording, cli, call.roomId]);

    const onClick = useCallback(async (ev: React.MouseEvent): Promise<void> => {
        ev.stopPropagation();
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

    const onToggleSidebar = useCallback((ev: React.MouseEvent): void => {
        ev.stopPropagation();
        const recorder = recorderRef.current;
        if (!recorder?.isRecording) return;
        recorder.setSidebarHidden(!recorder.isSidebarHidden);
    }, []);

    if (connectionState !== ConnectionState.Connected) {
        return null;
    }

    const ariaLabel = recording ? _t("voip|stop_call_recording") : _t("voip|start_call_recording");
    const sidebarAriaLabel = sidebarHidden ? _t("voip|show_sidebar_button") : _t("voip|hide_sidebar_button");

    return (
        <>
            {recording && (
                <Tooltip label={sidebarAriaLabel}>
                    <IconButton
                        className="mx_RoomHeader_recordingSidebarButton"
                        onClick={onToggleSidebar}
                        aria-label={sidebarAriaLabel}
                        aria-pressed={!sidebarHidden}
                    >
                        {sidebarHidden ? <SpotlightViewIcon /> : <ListViewIcon />}
                    </IconButton>
                </Tooltip>
            )}
            <Tooltip label={ariaLabel}>
                <IconButton
                    className={classNames("mx_RoomHeader_recordingButton", {
                        mx_RoomHeader_recordingButton_active: recording,
                    })}
                    onClick={onClick}
                    aria-label={ariaLabel}
                    aria-pressed={recording}
                >
                    {recording ? <StopSolidIcon /> : <span className="mx_RoomHeader_recordingButton_dot" />}
                </IconButton>
            </Tooltip>
        </>
    );
};

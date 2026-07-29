/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, MsgType, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import { _t } from "../languageHandler";

const logger = rootLogger.getChild("voip.sendCallRecordingNotice");

/**
 * Posts an m.notice to the room when a user starts or stops local call recording.
 */
export async function sendCallRecordingNotice(
    client: MatrixClient,
    roomId: string,
    recording: boolean,
): Promise<void> {
    const userId = client.getUserId();
    if (!userId) {
        return;
    }

    const member = client.getRoom(roomId)?.getMember(userId);
    const name = member?.name ?? userId;
    const body = recording
        ? _t("voip|user_started_call_recording", { name })
        : _t("voip|user_stopped_call_recording", { name });

    try {
        await client.sendEvent(roomId, EventType.RoomMessage, {
            msgtype: MsgType.Notice,
            body,
        });
    } catch (error) {
        logger.warn("Failed to send call recording notice", error);
    }
}

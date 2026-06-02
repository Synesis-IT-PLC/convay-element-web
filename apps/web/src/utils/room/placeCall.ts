/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type CallType } from "matrix-js-sdk/src/webrtc/call";
import { type Room } from "matrix-js-sdk/src/matrix";

import LegacyCallHandler from "../../LegacyCallHandler";
import { getPlatformCallTypeProps, PlatformCallType } from "../../hooks/room/useRoomCall";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import { Action } from "../../dispatcher/actions";
import PosthogTrackers from "../../PosthogTrackers";
import DMRoomMap from "../DMRoomMap";
import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import { _t } from "../../languageHandler";
import { IN_CALL_PRESENCE_STATUS } from "../../models/Call";

// Check if recipient's presence status_msg indicates they are in a call
function isDmRecipientBusy(room: Room): boolean {
    const dmUserId = DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    if (!dmUserId) return false;

    const client = room.client;

    const user = client.getUser(dmUserId);
    if (user?.presenceStatusMsg === IN_CALL_PRESENCE_STATUS) {
        return true;
    }

    return false;
}

/**
 * Helper to place a call in a room that works with all the legacy modes
 * @param room the room to place the call in
 * @param callType the type of call
 * @param platformCallType the platform to pass the call on
 * @param skipLobby Has the user indicated they would like to skip the lobby. Otherwise, defer to platform defaults.
 */
export const placeCall = async (
    room: Room,
    callType: CallType,
    platformCallType: PlatformCallType,
    skipLobby: boolean | undefined,
    voiceOnly: boolean,
): Promise<void> => {
    const { analyticsName } = getPlatformCallTypeProps(platformCallType);
    PosthogTrackers.trackInteraction(analyticsName);

    //if the recipient is busy modal
    if (isDmRecipientBusy(room)) {
        Modal.createDialog(ErrorDialog, {
            title: _t("voip|recipient_busy"),
            description: _t("voip|recipient_busy_description"),
        });
        return;
    }

    if (platformCallType == PlatformCallType.LegacyCall || platformCallType == PlatformCallType.JitsiCall) {
        await LegacyCallHandler.instance.placeCall(room.roomId, callType);
    } else if (platformCallType == PlatformCallType.ElementCall) {
        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            view_call: true,
            voiceOnly,
            skipLobby,
            metricsTrigger: undefined,
        });
    }
};

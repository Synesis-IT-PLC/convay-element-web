/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type CallType } from "matrix-js-sdk/src/webrtc/call";
import { type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

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


// Check if recipient's presence status_msg indicates they are in a call.
// Fetches fresh presence from the server to avoid stale cached data.
async function isDmRecipientBusy(room: Room): Promise<boolean> {

    const dmUserId = DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    if (!dmUserId) return false;

    const client = room.client;

    try {
        const presence = await client.getPresence(dmUserId);
        // Only consider the user busy if they are online AND have in_call status.
        // If they are offline/unavailable, the status_msg is stale from a previous session.
        if (presence.presence === "online" && presence.status_msg === IN_CALL_PRESENCE_STATUS) {
            logger.debug("isDmRecipientBusy: " + dmUserId + " is currently in a call (fresh presence check)");
            return true;
        }
    } catch (err) {
        logger.warn("isDmRecipientBusy: Failed to fetch fresh presence, falling back to cached:", err);
        // Fall back to cached presence if the server request fails
        const user = client.getUser(dmUserId);
        if (user?.presence === "online" && user?.presenceStatusMsg === IN_CALL_PRESENCE_STATUS) {
            logger.debug("isDmRecipientBusy: " + user?.displayName + " is currently in a call (cached presence)");
            return true;
        }

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
    if (await isDmRecipientBusy(room)) {

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

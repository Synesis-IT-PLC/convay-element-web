/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { Action } from "../dispatcher/actions";
import { type ViewRoomPayload } from "../dispatcher/payloads/ViewRoomPayload";
import dis from "../dispatcher/dispatcher";
import { type LocalRoom, LocalRoomState } from "../models/LocalRoom";
import { waitForRoomReadyAndApplyAfterCreateCallbacks } from "./local-room";
import { findDMRoom } from "./dm/findDMRoom";
import { createDmLocalRoom } from "./dm/createDmLocalRoom";
import { startDm } from "./dm/startDm";
import { resolveThreePids } from "./threepids";

export async function startDmOnFirstMessage(client: MatrixClient, targets: Member[]): Promise<string | null> {
    let resolvedTargets = targets;

    try {
        resolvedTargets = await resolveThreePids(targets, client);
    } catch (e) {
        logger.warn("Error resolving 3rd-party members", e);
    }

    const existingRoom = findDMRoom(client, resolvedTargets);

    if (existingRoom) {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: existingRoom.roomId,
            should_peek: false,
            joining: false,
            metricsTrigger: "MessageUser",
        });
        return existingRoom.roomId;
    }

    const room = await createDmLocalRoom(client, resolvedTargets);
    dis.dispatch({
        action: Action.ViewRoom,
        room_id: room.roomId,
        joining: false,
        targets: resolvedTargets,
    });
    return room.roomId;
}

/**
 * Starts a DM based on a local room.
 *
 * @async
 * @param {MatrixClient} client
 * @param {LocalRoom} localRoom
 * @returns {Promise<string | void>} Resolves to the created room id
 */
export async function createRoomFromLocalRoom(client: MatrixClient, localRoom: LocalRoom): Promise<string | void> {
    if (!localRoom.isNew) {
        // This action only makes sense for new local rooms.
        return;
    }

    localRoom.state = LocalRoomState.CREATING;
    client.emit(ClientEvent.Room, localRoom);

    return startDm(client, localRoom.targets, false).then(
        (roomId) => {
            if (!roomId) throw new Error(`startDm for local room ${localRoom.roomId} didn't return a room Id`);

            localRoom.actualRoomId = roomId;
            return waitForRoomReadyAndApplyAfterCreateCallbacks(client, localRoom, roomId);
        },
        () => {
            logger.warn(`Error creating DM for local room ${localRoom.roomId}`);
            localRoom.state = LocalRoomState.ERROR;
            client.emit(ClientEvent.Room, localRoom);
        },
    );
}

// This is the interface that is expected by various components in the Invite Dialog and RoomInvite.
// It is a bit awkward because it also matches the RoomMember class from the js-sdk with some extra support
// for 3PIDs/email addresses.
export abstract class Member {
    /**
     * The display name of this Member. For users this should be their profile's display
     * name or user ID if none set. For 3PIDs this should be the 3PID address (email).
     */
    public abstract get name(): string;

    /**
     * The ID of this Member. For users this should be their user ID. For 3PIDs this should
     * be the 3PID address (email).
     */
    public abstract get userId(): string;

    /**
     * Gets the MXC URL of this Member's avatar. For users this should be their profile's
     * avatar MXC URL or null if none set. For 3PIDs this should always be undefined.
     */
    public abstract getMxcAvatarUrl(): string | undefined;
}

export class DirectoryMember extends Member {
    private readonly _userId: string;
    private readonly displayName?: string;
    private readonly avatarUrl?: string;

    // eslint-disable-next-line camelcase
    public constructor(userDirResult: { user_id: string; display_name?: string; avatar_url?: string }) {
        super();
        this._userId = userDirResult.user_id;
        this.displayName = userDirResult.display_name;
        this.avatarUrl = userDirResult.avatar_url;
    }

    // These next class members are for the Member interface
    public get name(): string {
        return this.displayName || this._userId;
    }

    public get userId(): string {
        return this._userId;
    }

    public getMxcAvatarUrl(): string | undefined {
        return this.avatarUrl;
    }
}

export class ThreepidMember extends Member {
    private readonly id: string;

    public constructor(id: string) {
        super();
        this.id = id;
    }

    // This is a getter that would be falsy on all other implementations. Until we have
    // better type support in the react-sdk we can use this trick to determine the kind
    // of 3PID we're dealing with, if any.
    public get isEmail(): boolean {
        return this.id.includes("@");
    }

    // These next class members are for the Member interface
    public get name(): string {
        return this.id;
    }

    public get userId(): string {
        return this.id;
    }

    public getMxcAvatarUrl(): string | undefined {
        return undefined;
    }
}

export interface IDMUserTileProps {
    member: Member;
    onRemove?(member: Member): void;
}

/**
 * Detects whether a room should be encrypted.
 *
 * @async
 * @param {MatrixClient} client
 * @param {Member[]} targets The members to which run the check against
 * @returns {Promise<boolean>}
 */
export async function determineCreateRoomEncryptionOption(client: MatrixClient, targets: Member[]): Promise<boolean> {
    // DMs are always created unencrypted by default.
    return false;
}

/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2022 The Matrix.org Foundation C.I.C.
Copyright 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { createRef } from "react";
import {
    Filter,
    Direction,
    EventTimeline,
    EventType,
    RelationType,
    type EventTimelineSet,
    type IRoomTimelineData,
    type MatrixEvent,
    MatrixEventEvent,
    type Room,
    RoomEvent,
    type TimelineWindow,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import FilesIcon from "@vector-im/compound-design-tokens/assets/web/icons/files";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import EventIndexPeg from "../../indexing/EventIndexPeg";
import { _t } from "../../languageHandler";
import SearchWarning, { WarningKind } from "../views/elements/SearchWarning";
import BaseCard from "../views/right_panel/BaseCard";
import TimelinePanel from "./TimelinePanel";
import Spinner from "../views/elements/Spinner";
import { Layout } from "../../settings/enums/Layout";
import RoomContext, { TimelineRenderingType } from "../../contexts/RoomContext";
import Measured from "../views/elements/Measured";
import EmptyState from "../views/right_panel/EmptyState";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext.tsx";

interface IProps {
    roomId: string;
    onClose: () => void;
}

interface IState {
    timelineSet: EventTimelineSet | null;
    narrow: boolean;
}

/*
 * Component which shows the filtered file using a TimelinePanel
 */
const FILE_MSGTYPES = ["m.file", "m.image", "m.video", "m.audio"];
const SCAN_PAGE_SIZE = 100;
// Bounds how many /messages pages a single fill/pagination request may fetch,
// so rooms with lots of messages and few files don't stall the panel.
const SCAN_MAX_PAGES_PER_REQUEST = 10;
const CLIENT_SCAN_PAGINATION_TOKEN = "client-scan";

class FilePanel extends React.Component<IProps, IState> {
    public static contextType = RoomContext;
    declare public context: React.ContextType<typeof RoomContext>;

    // This is used to track if a decrypted event was a live event and should be
    // added to the timeline.
    private decryptingEvents = new Set<string>();
    public noRoom = false;
    private card = createRef<HTMLDivElement>();
    // Bumped on every mount/unmount so async work started by a previous mount
    // (e.g. StrictMode's simulated unmount/remount) can detect it is stale.
    private loadGeneration = 0;

    // State for scanning encrypted rooms client-side when no event index is available.
    private serverScanToken: string | null = null;
    private serverScanFinished = false;
    private listeningForLiveEvents = false;

    public state: IState = {
        timelineSet: null,
        narrow: false,
    };

    private onRoomTimeline = (
        ev: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        removed: boolean,
        data: IRoomTimelineData,
    ): void => {
        if (room?.roomId !== this.props.roomId) return;
        if (toStartOfTimeline || !data || !data.liveEvent || ev.isRedacted()) return;

        const client = MatrixClientPeg.safeGet();
        client.decryptEventIfNeeded(ev);

        if (ev.isBeingDecrypted()) {
            this.decryptingEvents.add(ev.getId()!);
        } else {
            this.addEncryptedLiveEvent(ev);
        }
    };

    private onEventDecrypted = (ev: MatrixEvent, err?: any): void => {
        if (ev.getRoomId() !== this.props.roomId) return;
        const eventId = ev.getId()!;

        if (!this.decryptingEvents.delete(eventId)) return;
        if (err) return;

        this.addEncryptedLiveEvent(ev);
    };

    public addEncryptedLiveEvent(ev: MatrixEvent): void {
        if (!this.state.timelineSet) return;

        const timeline = this.state.timelineSet.getLiveTimeline();
        if (ev.getType() !== "m.room.message") return;
        if (!FILE_MSGTYPES.includes(ev.getContent().msgtype!)) {
            return;
        }

        if (!this.state.timelineSet.eventIdToTimeline(ev.getId()!)) {
            this.state.timelineSet.addEventToTimeline(ev, timeline, {
                fromCache: false,
                addToState: false,
                toStartOfTimeline: false,
            });
        }
    }

    public async componentDidMount(): Promise<void> {
        const client = MatrixClientPeg.safeGet();
        const generation = ++this.loadGeneration;

        await this.updateTimelineSet(this.props.roomId);

        if (generation !== this.loadGeneration) return;

        if (!client.isRoomEncrypted(this.props.roomId)) return;

        // The timelineSets filter makes sure that encrypted events that contain
        // URLs never get added to the timeline, even if they are live events.
        // These methods are here to manually listen for such events and add
        // them despite the filter's best efforts.
        //
        // We do this only for encrypted rooms, either backed by the event index
        // or by the client-side history scan.
        if (this.listeningForLiveEvents) return;
        client.on(RoomEvent.Timeline, this.onRoomTimeline);
        client.on(MatrixEventEvent.Decrypted, this.onEventDecrypted);
        this.listeningForLiveEvents = true;
    }

    public componentWillUnmount(): void {
        this.loadGeneration++;

        const client = MatrixClientPeg.get();
        if (client === null) return;

        if (this.listeningForLiveEvents) {
            client.removeListener(RoomEvent.Timeline, this.onRoomTimeline);
            client.removeListener(MatrixEventEvent.Decrypted, this.onEventDecrypted);
            this.listeningForLiveEvents = false;
        }
    }

    private shouldUseClientScan(roomId: string): boolean {
        const client = MatrixClientPeg.safeGet();
        return client.isRoomEncrypted(roomId) && EventIndexPeg.get() === null;
    }

    private isFileEvent(ev: MatrixEvent): boolean {
        if (ev.isRedacted() || ev.isDecryptionFailure()) return false;
        if (ev.getType() !== EventType.RoomMessage) return false;
        if (ev.getRelation()?.rel_type === RelationType.Replace) return false;
        return FILE_MSGTYPES.includes(ev.getContent().msgtype!);
    }

    /**
     * Walks the room history backwards via /messages, decrypting events locally,
     * until `limit` file events are found or the start of the room is reached.
     * The server can't filter encrypted events by `contains_url`, so this is
     * the only way to find older files in encrypted rooms without an event index.
     */
    private async scanServerForFileEvents(
        room: Room,
        limit: number,
        generation: number,
    ): Promise<MatrixEvent[] | null> {
        const client = MatrixClientPeg.safeGet();
        const mapper = client.getEventMapper();
        const found: MatrixEvent[] = [];
        let pages = 0;

        while (found.length < limit && !this.serverScanFinished && pages < SCAN_MAX_PAGES_PER_REQUEST) {
            pages++;
            const res = await client.createMessagesRequest(
                room.roomId,
                this.serverScanToken,
                SCAN_PAGE_SIZE,
                Direction.Backward,
            );
            if (generation !== this.loadGeneration) return null;
            const events = (res.chunk ?? []).map(mapper);

            await Promise.all(
                events.map((ev) =>
                    client.decryptEventIfNeeded(ev).catch((e) => {
                        logger.warn("FilePanel: failed to decrypt event", ev.getId(), e);
                    }),
                ),
            );
            if (generation !== this.loadGeneration) return null;

            for (const ev of events) {
                if (!this.isFileEvent(ev)) continue;
                const member = room.getMember(ev.getSender()!);
                if (member) ev.sender = member;
                found.push(ev);
            }

            this.serverScanToken = res.end ?? null;
            if (!res.end || events.length === 0) this.serverScanFinished = true;
        }

        return found;
    }

    private async populateFromServerScan(
        timelineSet: EventTimelineSet,
        timeline: EventTimeline,
        room: Room,
        limit: number,
    ): Promise<boolean> {
        const generation = this.loadGeneration;
        let events: MatrixEvent[] = [];
        try {
            const scanned = await this.scanServerForFileEvents(room, limit, generation);
            if (scanned === null) return false;
            events = scanned;
        } catch (e) {
            if (generation !== this.loadGeneration) return false;
            logger.error("FilePanel: failed to scan room history for files", e);
            this.serverScanFinished = true;
        }

        // /messages returns newest first, so prepending in order keeps the
        // timeline chronological.
        for (const ev of events) {
            if (!timelineSet.eventIdToTimeline(ev.getId()!)) {
                timelineSet.addEventToTimeline(ev, timeline, {
                    toStartOfTimeline: true,
                    fromCache: false,
                    addToState: false,
                });
            }
        }

        // TimelineWindow.canPaginate() relies on a non-null token.
        timeline.setPaginationToken(
            this.serverScanFinished ? null : CLIENT_SCAN_PAGINATION_TOKEN,
            EventTimeline.BACKWARDS,
        );
        return events.length > 0;
    }

    private paginateFromServerScan(
        room: Room,
        timelineWindow: TimelineWindow,
        direction: Direction,
        limit: number,
    ): Promise<boolean> {
        if (direction === Direction.Forward) return timelineWindow.paginate(direction, limit);

        const tl = timelineWindow.getTimelineIndex(direction);
        if (!tl) return Promise.resolve(false);
        if (tl.pendingPaginate) return tl.pendingPaginate;

        if (timelineWindow.extend(direction, limit)) {
            return Promise.resolve(true);
        }

        const promise = (async (): Promise<boolean> => {
            const timeline = tl.timeline;
            const ret = await this.populateFromServerScan(timeline.getTimelineSet(), timeline, room, limit);
            tl.pendingPaginate = undefined;
            timelineWindow.extend(direction, limit);
            return ret;
        })();
        tl.pendingPaginate = promise;
        return promise;
    }

    public async fetchFileEventsServer(room: Room): Promise<EventTimelineSet> {
        const client = MatrixClientPeg.safeGet();

        const filter = new Filter(client.getSafeUserId());
        filter.setDefinition({
            room: {
                timeline: {
                    contains_url: true,
                    types: ["m.room.message"],
                },
            },
        });

        filter.filterId = await client.getOrCreateFilter("FILTER_FILES_" + client.credentials.userId, filter);
        return room.getOrCreateFilteredTimelineSet(filter);
    }

    private onPaginationRequest = (
        timelineWindow: TimelineWindow,
        direction: Direction,
        limit: number,
    ): Promise<boolean> => {
        const client = MatrixClientPeg.safeGet();
        const eventIndex = EventIndexPeg.get();
        const roomId = this.props.roomId;

        const room = client.getRoom(roomId);

        // We override the pagination request for encrypted rooms so that we ask
        // the event index to fulfill the pagination request. Asking the server
        // to paginate won't ever work since the server can't correctly filter
        // out events containing URLs
        if (room && client.isRoomEncrypted(roomId) && eventIndex !== null) {
            return eventIndex.paginateTimelineWindow(room, timelineWindow, direction, limit);
        } else if (room && this.shouldUseClientScan(roomId)) {
            return this.paginateFromServerScan(room, timelineWindow, direction, limit);
        } else {
            return timelineWindow.paginate(direction, limit);
        }
    };

    private onMeasurement = (narrow: boolean): void => {
        this.setState({ narrow });
    };

    public async updateTimelineSet(roomId: string): Promise<void> {
        const generation = this.loadGeneration;
        const client = MatrixClientPeg.safeGet();
        const room = client.getRoom(roomId);
        const eventIndex = EventIndexPeg.get();

        this.noRoom = !room;

        if (room) {
            let timelineSet;

            try {
                timelineSet = await this.fetchFileEventsServer(room);
                if (generation !== this.loadGeneration) return;

                // If this room is encrypted the file panel won't be populated
                // correctly since the defined filter doesn't support encrypted
                // events and the server can't check if encrypted events contain
                // URLs.
                //
                // This is where our event index comes into place, we ask the
                // event index to populate the timelineSet for us. This call
                // will add 10 events to the live timeline of the set. More can
                // be requested using pagination.
                if (client.isRoomEncrypted(roomId) && eventIndex !== null) {
                    const timeline = timelineSet.getLiveTimeline();
                    await eventIndex.populateFileTimeline(timelineSet, timeline, room, 10);
                } else if (this.shouldUseClientScan(roomId)) {
                    // Without an event index (e.g. on web), scan the room history
                    // and decrypt events locally to find files.
                    this.serverScanToken = null;
                    this.serverScanFinished = false;
                    await this.populateFromServerScan(timelineSet, timelineSet.getLiveTimeline(), room, 10);
                }

                if (generation !== this.loadGeneration) return;
                this.setState({ timelineSet: timelineSet });
            } catch (error) {
                logger.error("Failed to get or create file panel filter", error);
            }
        } else {
            logger.error("Failed to add filtered timelineSet for FilePanel as no room!");
        }
    }

    public render(): React.ReactNode {
        if (MatrixClientPeg.safeGet().isGuest()) {
            return (
                <BaseCard
                    className="mx_FilePanel mx_RoomView_messageListWrapper"
                    onClose={this.props.onClose}
                    header={_t("right_panel|files_button")}
                >
                    <div className="mx_RoomView_empty">
                        {_t(
                            "file_panel|guest_note",
                            {},
                            {
                                a: (sub) => (
                                    <a href="#/register" key="sub">
                                        {sub}
                                    </a>
                                ),
                            },
                        )}
                    </div>
                </BaseCard>
            );
        } else if (this.noRoom) {
            return (
                <BaseCard
                    className="mx_FilePanel mx_RoomView_messageListWrapper"
                    onClose={this.props.onClose}
                    header={_t("right_panel|files_button")}
                >
                    <div className="mx_RoomView_empty">{_t("file_panel|peek_note")}</div>
                </BaseCard>
            );
        }

        // wrap a TimelinePanel with the jump-to-event bits turned off.

        const emptyState = (
            <EmptyState
                Icon={FilesIcon}
                title={_t("file_panel|empty_heading")}
                description={_t("file_panel|empty_description")}
            />
        );

        const isRoomEncrypted = this.noRoom ? false : MatrixClientPeg.safeGet().isRoomEncrypted(this.props.roomId);

        if (this.state.timelineSet) {
            return (
                <ScopedRoomContextProvider
                    {...this.context}
                    timelineRenderingType={TimelineRenderingType.File}
                    narrow={this.state.narrow}
                >
                    <BaseCard
                        className="mx_FilePanel"
                        onClose={this.props.onClose}
                        withoutScrollContainer
                        ref={this.card}
                        header={_t("right_panel|files_button")}
                    >
                        <Measured sensor={this.card} onMeasurement={this.onMeasurement} />
                        <SearchWarning isRoomEncrypted={isRoomEncrypted} kind={WarningKind.Files} />
                        <TimelinePanel
                            manageReadReceipts={false}
                            manageReadMarkers={false}
                            timelineSet={this.state.timelineSet}
                            showUrlPreview={false}
                            onPaginationRequest={this.onPaginationRequest}
                            empty={emptyState}
                            layout={Layout.Group}
                        />
                    </BaseCard>
                </ScopedRoomContextProvider>
            );
        } else {
            return (
                <ScopedRoomContextProvider {...this.context} timelineRenderingType={TimelineRenderingType.File}>
                    <BaseCard
                        className="mx_FilePanel"
                        onClose={this.props.onClose}
                        header={_t("right_panel|files_button")}
                    >
                        <Spinner />
                    </BaseCard>
                </ScopedRoomContextProvider>
            );
        }
    }
}

export default FilePanel;

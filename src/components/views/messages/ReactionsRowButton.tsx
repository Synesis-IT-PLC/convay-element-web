/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { createRef } from "react";
import classNames from "classnames";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mediaFromMxc } from "../../../customisations/Media";
import { _t } from "../../../languageHandler";
import { formatList } from "../../../utils/FormattingUtils";
import ReactionsRowButtonTooltip from "./ReactionsRowButtonTooltip";
import AccessibleButton from "../elements/AccessibleButton";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import ContextMenu, { aboveLeftOf } from "../../structures/ContextMenu";
import MemberAvatar from "../avatars/MemberAvatar";
import { REACTION_SHORTCODE_KEY } from "./ReactionsRow";

export interface IProps {
    // The event we're displaying reactions for
    mxEvent: MatrixEvent;
    // The reaction content / key / emoji
    content: string;
    // The count of votes for this key
    count: number;
    // A list of Matrix reaction events for this key
    reactionEvents: MatrixEvent[];
    // A possible Matrix event if the current user has voted for this type
    myReactionEvent?: MatrixEvent;
    // Whether to render custom image reactions
    customReactionImagesEnabled?: boolean;
}

interface IState {
    menuDisplayed: boolean;
}

export default class ReactionsRowButton extends React.PureComponent<IProps, IState> {
    public static contextType = MatrixClientContext;
    declare public context: React.ContextType<typeof MatrixClientContext>;

    private buttonRef = createRef<HTMLDivElement>();

    public state: IState = {
        menuDisplayed: false,
    };

    public onClick = (): void => {
        this.setState({ menuDisplayed: true });
    };

    private closeMenu = (): void => {
        this.setState({ menuDisplayed: false });
    };

    public render(): React.ReactNode {
        const { mxEvent, content, count, reactionEvents, myReactionEvent } = this.props;

        const classes = classNames({
            mx_ReactionsRowButton: true,
            mx_ReactionsRowButton_selected: !!myReactionEvent,
        });

        const room = this.context.getRoom(mxEvent.getRoomId());
        let label: string | undefined;
        let customReactionName: string | undefined;
        if (room) {
            const senders: string[] = [];
            for (const reactionEvent of reactionEvents) {
                const member = room.getMember(reactionEvent.getSender()!);
                senders.push(member?.name || reactionEvent.getSender()!);
                customReactionName =
                    (this.props.customReactionImagesEnabled &&
                        REACTION_SHORTCODE_KEY.findIn(reactionEvent.getContent())) ||
                    undefined;
            }

            const reactors = formatList(senders, 6);
            if (content) {
                label = _t("timeline|reactions|label", {
                    reactors,
                    content: customReactionName || content,
                });
            } else {
                label = reactors;
            }
        }

        let reactionContent = (
            <span className="mx_ReactionsRowButton_content" aria-hidden="true">
                {content}
            </span>
        );
        if (this.props.customReactionImagesEnabled && content.startsWith("mxc://")) {
            const imageSrc = mediaFromMxc(content).srcHttp;
            if (imageSrc) {
                reactionContent = (
                    <img
                        className="mx_ReactionsRowButton_content"
                        alt={customReactionName || _t("timeline|reactions|custom_reaction_fallback_label")}
                        src={imageSrc}
                        width="16"
                        height="16"
                    />
                );
            }
        }

        let contextMenu: React.ReactNode;
        if (this.state.menuDisplayed && this.buttonRef.current && room) {
            const buttonRect = this.buttonRef.current.getBoundingClientRect();
            contextMenu = (
                <ContextMenu {...aboveLeftOf(buttonRect)} onFinished={this.closeMenu} managed={false} focusLock>
                    <div className="mx_ReactionsRowButton_reactorList">
                        <div className="mx_ReactionsRowButton_reactorList_header">
                            {reactionContent}
                            <span className="mx_ReactionsRowButton_count">{count}</span>
                        </div>
                        <ul className="mx_ReactionsRowButton_reactorList_items">
                            {reactionEvents.map((reactionEvent) => {
                                const sender = reactionEvent.getSender()!;
                                const member = room.getMember(sender);
                                return (
                                    <li key={sender} className="mx_ReactionsRowButton_reactorList_item">
                                        <MemberAvatar member={member} fallbackUserId={sender} size="24px" />
                                        <span className="mx_ReactionsRowButton_reactorList_name">
                                            {member?.name ?? sender}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </ContextMenu>
            );
        }

        return (
            <>
                <ReactionsRowButtonTooltip
                    mxEvent={this.props.mxEvent}
                    content={content}
                    reactionEvents={reactionEvents}
                    customReactionImagesEnabled={this.props.customReactionImagesEnabled}
                >
                    <AccessibleButton
                        ref={this.buttonRef}
                        className={classes}
                        aria-label={label}
                        aria-haspopup="true"
                        aria-expanded={this.state.menuDisplayed}
                        onClick={this.onClick}
                    >
                        {reactionContent}
                        <span className="mx_ReactionsRowButton_count" aria-hidden="true">
                            {count}
                        </span>
                    </AccessibleButton>
                </ReactionsRowButtonTooltip>
                {contextMenu}
            </>
        );
    }
}

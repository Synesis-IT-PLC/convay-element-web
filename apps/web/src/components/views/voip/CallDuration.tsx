/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type FC, useState, useEffect, memo } from "react";
import { type MatrixRTCSession } from "matrix-js-sdk/src/matrixrtc";
import { Clock } from "@element-hq/web-shared-components";

import { formatPreciseDuration } from "../../../DateUtils";

interface CallDurationProps {
    delta: number;
}

/**
 * A call duration counter.
 */
export const CallDuration: FC<CallDurationProps> = memo(({ delta }) => {
    // Clock desync could lead to a negative duration, so just hide it if that happens
    if (delta <= 0) return null;
    return <div className="mx_CallDuration">{formatPreciseDuration(delta)}</div>;
});

interface SessionDurationProps {
    session: MatrixRTCSession | undefined;
}

/**
 * A call duration counter that automatically counts up, given a matrixRTC session
 * object.
 */
export const SessionDuration: FC<SessionDurationProps> = ({ session }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    // This is a temporal solution.
    // Using the oldest membership will update when this user leaves.
    // This implies that the displayed call duration will also update consequently.
    const createdTs = session?.getOldestMembership()?.createdTs();
    return createdTs ? <CallDuration delta={now - createdTs} /> : <CallDuration delta={0} />;
};

interface SessionClockProps {
    session: MatrixRTCSession | undefined;
}

/**
 * A call duration counter that renders a clock component, given a matrixRTC session.
 */
export const SessionClock: FC<SessionClockProps> = ({ session }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const createdTs = session?.getOldestMembership()?.createdTs();
    if (!createdTs || now <= createdTs) return null;

    const seconds = Math.floor((now - createdTs) / 1000);
    return <Clock seconds={seconds} aria-live="off" />;
};

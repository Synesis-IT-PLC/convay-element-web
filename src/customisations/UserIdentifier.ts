/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { UserIdentifierCustomisations } from "@element-hq/element-web-module-api";
import { MatrixClientPeg } from "../MatrixClientPeg";

/**
 * Strip the `:server` suffix from a Matrix identifier (user ID or room alias)
 * when it belongs to our own homeserver. Identifiers on other servers are
 * returned unchanged so they can't be confused with local ones.
 */
export function stripOwnServerName(identifier: string): string {
    const domain = MatrixClientPeg.get()?.getDomain();
    if (domain && identifier.endsWith(":" + domain)) {
        return identifier.slice(0, -(domain.length + 1));
    }
    return identifier;
}

/**
 * Customise display of the user identifier
 * hide userId for guests, display 3pid
 *
 * Set withDisplayName to true when user identifier will be displayed alongside user name
 */
function getDisplayUserIdentifier(
    userId: string,
    { roomId, withDisplayName }: { roomId?: string; withDisplayName?: boolean },
): string | null {
    return stripOwnServerName(userId);
}

// A real customisation module will define and export one or more of the
// customisation points that make up `IUserIdentifierCustomisations`.
export default {
    getDisplayUserIdentifier,
} as UserIdentifierCustomisations;

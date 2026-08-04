/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** Baked in at build time from MATRIX_PASSWORD in .env */
export function getMatrixPassword(): string | undefined {
    const password = process.env.MATRIX_PASSWORD;
    return password || undefined;
}

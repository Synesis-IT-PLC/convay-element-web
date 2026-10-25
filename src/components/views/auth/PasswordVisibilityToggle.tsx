/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { IconButton } from "@vector-im/compound-web";
import VisibilityOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-on";
import VisibilityOffIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-off";

import { _t } from "../../../languageHandler";

interface Props {
    visible: boolean;
    onToggle(): void;
}

/**
 * An eye button to show or hide the contents of a password field.
 */
export default function PasswordVisibilityToggle({ visible, onToggle }: Props): JSX.Element {
    return (
        <IconButton
            type="button"
            size="24px"
            className="mx_PasswordVisibilityToggle"
            aria-label={visible ? _t("action|hide") : _t("action|show")}
            aria-pressed={visible}
            onClick={onToggle}
        >
            {visible ? <VisibilityOffIcon /> : <VisibilityOnIcon />}
        </IconButton>
    );
}

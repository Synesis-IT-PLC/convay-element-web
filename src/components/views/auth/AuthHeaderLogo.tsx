/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";

import SdkConfig from "../../../SdkConfig";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ActionPayload } from "../../../dispatcher/payloads";

const DEFAULT_LOGO_URL = "themes/element/img/logos/element-logo.svg";

export default class AuthHeaderLogo extends React.Component {
    private dispatcherRef?: string;

    public componentDidMount(): void {
        this.dispatcherRef = dis.register(this.onAction);
    }

    public componentWillUnmount(): void {
        dis.unregister(this.dispatcherRef);
    }

    private onAction = (payload: ActionPayload): void => {
        if (payload.action === Action.OrgBrandingUpdated) {
            this.forceUpdate();
        }
    };

    public render(): React.ReactElement {
        const brandingConfig = SdkConfig.getObject("branding");
        const logoUrl = brandingConfig?.get("auth_header_logo_url") ?? DEFAULT_LOGO_URL;
        const brand = SdkConfig.get().brand;

        return (
            <aside className="mx_AuthHeaderLogo">
                <img src={logoUrl} alt={brand} />
            </aside>
        );
    }
}

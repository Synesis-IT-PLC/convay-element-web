/*
Copyright 2019-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import classNames from "classnames";
import { type EmptyObject } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../../SdkConfig";
import AuthPage from "./AuthPage";
import SettingsStore from "../../../settings/SettingsStore";
import { UIFeature } from "../../../settings/UIFeature";
import LanguageSelector from "./LanguageSelector";
import EmbeddedPage from "../../structures/EmbeddedPage";
import { MATRIX_LOGO_HTML } from "../../structures/static-page-vars";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ActionPayload } from "../../../dispatcher/payloads";
import {
    maybeRefreshOrgBrandingOnLoad,
    refreshOrgBrandingFromFragment,
} from "../../../utils/applyOrgBranding";

const DEFAULT_LOGO_URL = "themes/element/img/logos/element-logo.svg";

interface IState {
    logoUrl: string;
    brand: string;
}

export default class Welcome extends React.Component<EmptyObject, IState> {
    private dispatcherRef?: string;

    public constructor(props: EmptyObject) {
        super(props);
        this.state = this.getBrandingState();
    }

    private getBrandingState(): IState {
        const brandingConfig = SdkConfig.getObject("branding");
        return {
            logoUrl: brandingConfig?.get("auth_header_logo_url") ?? DEFAULT_LOGO_URL,
            brand: SdkConfig.get().brand,
        };
    }

    public componentDidMount(): void {
        this.dispatcherRef = dis.register(this.onAction);
        void refreshOrgBrandingFromFragment();
        void maybeRefreshOrgBrandingOnLoad();
    }

    public componentWillUnmount(): void {
        dis.unregister(this.dispatcherRef);
    }

    private onAction = (payload: ActionPayload): void => {
        if (payload.action === Action.OrgBrandingUpdated) {
            this.setState(this.getBrandingState());
        }
    };

    public render(): React.ReactNode {
        const pagesConfig = SdkConfig.getObject("embedded_pages");
        let pageUrl: string | undefined;

        const authRedirectUrl = SdkConfig.get("auth_pages_redirect_url");
        const authSignInUrl = SdkConfig.get("auth_signin_url");
        const authSignUpUrl = SdkConfig.get("auth_signup_url");

        if (pagesConfig) {
            pageUrl = pagesConfig.get("welcome_url");
        }

        const replaceMap: Record<string, string> = {
            "$brand": this.state.brand,
            "$riot:ssoUrl": "#/start_sso",
            "$riot:casUrl": "#/start_cas",
            "$matrixLogo": MATRIX_LOGO_HTML,
            "[matrix]": MATRIX_LOGO_HTML,
        };

        if (!pageUrl) {
            // Fall back to default and replace $logoUrl in welcome.html
            replaceMap["$logoUrl"] = this.state.logoUrl;
            replaceMap["$signInUrl"] = authSignInUrl ?? authRedirectUrl ?? "#/login";
            replaceMap["$signUpUrl"] = authSignUpUrl ?? authRedirectUrl ?? "#/register";
            pageUrl = "welcome.html";
        }

        return (
            <AuthPage>
                <div
                    className={classNames("mx_Welcome", {
                        mx_WelcomePage_registrationDisabled: !SettingsStore.getValue(UIFeature.Registration),
                    })}
                    data-testid="mx_welcome_screen"
                >
                    <EmbeddedPage className="mx_WelcomePage" url={pageUrl} replaceMap={replaceMap} />
                    <LanguageSelector />
                </div>
            </AuthPage>
        );
    }
}

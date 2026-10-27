/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ComponentProps, PureComponent, type Ref } from "react";
import classNames from "classnames";

import type { ZxcvbnResult } from "@zxcvbn-ts/core";
import { CheckIcon, CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import SdkConfig from "../../../SdkConfig";
import withValidation, { type IFieldState, type IValidationResult } from "../elements/Validation";
import { _t, _td } from "../../../languageHandler";
import Field, { type IInputProps } from "../elements/Field";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import PasswordVisibilityToggle from "./PasswordVisibilityToggle";

const PASSPHRASE_REQUIREMENTS: { key: string; label: TranslationKey; test: (value: string) => boolean }[] = [
    { key: "length", label: _td("auth|passphrase_requirement_length"), test: (v) => v.length >= 12 },
    { key: "number", label: _td("auth|passphrase_requirement_number"), test: (v) => /\p{N}/u.test(v) },
    { key: "special", label: _td("auth|passphrase_requirement_special"), test: (v) => /[^\p{L}\p{N}\s]/u.test(v) },
    { key: "uppercase", label: _td("auth|passphrase_requirement_uppercase"), test: (v) => /\p{Lu}/u.test(v) },
];

const meetsAllRequirements = (value: string): boolean => PASSPHRASE_REQUIREMENTS.every(({ test }) => test(value));

interface IProps extends Omit<IInputProps, "onValidate" | "element"> {
    autoFocus?: boolean;
    id?: string;
    className?: string;
    minScore: 0 | 1 | 2 | 3 | 4;
    value: string;
    fieldRef?: Ref<Field>;
    // Additional strings such as a username used to catch bad passwords
    userInputs?: string[];

    label: TranslationKey;
    labelEnterPassword: TranslationKey;
    labelStrongPassword: TranslationKey;
    labelAllowedButUnsafe: TranslationKey;
    tooltipAlignment?: ComponentProps<typeof Field>["tooltipAlignment"];
    // Show an eye button that lets the user reveal what they typed
    showVisibilityToggle?: boolean;
    // Show a checklist of required character types in the validation tooltip; all must be met to be valid
    showRequirementsChecklist?: boolean;
    // Reject values longer than this many characters
    maxPhraseLength?: number;

    onChange(ev: React.FormEvent<HTMLElement>): void;
    onValidate?(result: IValidationResult): void;
}

interface IState {
    visible: boolean;
}

class PassphraseField extends PureComponent<IProps, IState> {
    public state: IState = { visible: false };

    public static defaultProps = {
        label: _td("common|password"),
        labelEnterPassword: _td("auth|password_field_label"),
        labelStrongPassword: _td("auth|password_field_strong_label"),
        labelAllowedButUnsafe: _td("auth|password_field_weak_label"),
    };

    private isTooLong(value: string | null): boolean {
        const max = this.props.maxPhraseLength;
        return !!max && (value ?? "").length > max;
    }

    public readonly validate = withValidation<this, ZxcvbnResult | null>({
        description: function (complexity) {
            const score = complexity ? complexity.score : 0;
            const progress = <progress className="mx_PassphraseField_progress" max={4} value={score} />;
            if (!this.props.showRequirementsChecklist) return progress;

            const value = this.props.value ?? "";
            return (
                <>
                    {progress}
                    <ul className="mx_Validation_details mx_PassphraseField_requirements">
                        {PASSPHRASE_REQUIREMENTS.map(({ key, label, test }) => {
                            const met = test(value);
                            return (
                                <li
                                    key={key}
                                    className={classNames("mx_Validation_detail", {
                                        mx_Validation_valid: met,
                                        mx_Validation_invalid: !met,
                                    })}
                                >
                                    {met ? <CheckIcon /> : <CloseIcon />}
                                    {_t(label)}
                                </li>
                            );
                        })}
                    </ul>
                </>
            );
        },
        deriveData: async ({ value }): Promise<ZxcvbnResult | null> => {
            if (!value) return null;
            const { scorePassword } = await import("../../../utils/PasswordScorer");
            return scorePassword(MatrixClientPeg.get(), value, this.props.userInputs);
        },
        rules: [
            {
                key: "required",
                test: ({ value, allowEmpty }) => allowEmpty || !!value,
                invalid: () => _t(this.props.labelEnterPassword),
            },
            {
                key: "maxLength",
                skip: function ({ value }) {
                    return !this.props.maxPhraseLength || !value;
                },
                test: function ({ value }) {
                    return !this.isTooLong(value);
                },
                invalid: function () {
                    return _t("auth|passphrase_too_long", { max: this.props.maxPhraseLength });
                },
            },
            {
                key: "requirements",
                skip: function ({ value }) {
                    return !this.props.showRequirementsChecklist || !value;
                },
                test: ({ value }) => meetsAllRequirements(value ?? ""),
            },
            {
                key: "complexity",
                test: async function ({ value }, complexity): Promise<boolean> {
                    if (!value || !complexity) {
                        return false;
                    }
                    const safe = complexity.score >= this.props.minScore;
                    const allowUnsafe = SdkConfig.get("dangerously_allow_unsafe_and_insecure_passwords");
                    return allowUnsafe || safe;
                },
                valid: function (complexity) {
                    // Unsafe passwords that are valid are only possible through a
                    // configuration flag. We'll print some helper text to signal
                    // to the user that their password is allowed, but unsafe.
                    if (complexity && complexity.score >= this.props.minScore) {
                        const value = this.props.value ?? "";
                        if (this.isTooLong(value)) return null;
                        if (this.props.showRequirementsChecklist && !meetsAllRequirements(value)) {
                            return null;
                        }
                        return _t(this.props.labelStrongPassword);
                    }
                    return _t(this.props.labelAllowedButUnsafe);
                },
                invalid: function (complexity) {
                    if (!complexity) {
                        return null;
                    }
                    const { feedback } = complexity;
                    return feedback.warning || feedback.suggestions[0] || _t("auth|password_field_keep_going_prompt");
                },
            },
        ],
        memoize: true,
    });

    public onValidate = async (fieldState: IFieldState): Promise<IValidationResult> => {
        const result = await this.validate(fieldState);
        if (this.props.onValidate) {
            this.props.onValidate(result);
        }
        return result;
    };

    public render(): React.ReactNode {
        return (
            <Field
                id={this.props.id}
                autoFocus={this.props.autoFocus}
                className={classNames("mx_PassphraseField", this.props.className)}
                ref={this.props.fieldRef}
                type={this.state.visible ? "text" : "password"}
                autoComplete="new-password"
                label={_t(this.props.label)}
                value={this.props.value}
                onChange={this.props.onChange}
                onValidate={this.onValidate}
                tooltipAlignment={this.props.tooltipAlignment}
                postfixComponent={
                    this.props.showVisibilityToggle ? (
                        <PasswordVisibilityToggle
                            visible={this.state.visible}
                            onToggle={() => this.setState(({ visible }) => ({ visible: !visible }))}
                        />
                    ) : undefined
                }
            />
        );
    }
}

export default PassphraseField;

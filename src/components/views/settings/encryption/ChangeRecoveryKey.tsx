/*
 * Copyright 2025 Element Creations Ltd.
 * Copyright 2024 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type MouseEventHandler, useState } from "react";
import {
    Breadcrumb,
    Button,
    ErrorMessage,
    Field,
    IconButton,
    Label,
    PasswordControl,
    Root,
    Text,
} from "@vector-im/compound-web";
import CopyIcon from "@vector-im/compound-design-tokens/assets/web/icons/copy";
import KeyIcon from "@vector-im/compound-design-tokens/assets/web/icons/key-solid";
import { type GeneratedSecretStorageKey } from "matrix-js-sdk/src/crypto-api";

import { _t, _td } from "../../../../languageHandler";
import PassphraseField from "../../auth/PassphraseField";
import PassphraseConfirmField from "../../auth/PassphraseConfirmField";
import { EncryptionCard } from "./EncryptionCard";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { copyPlaintext } from "../../../../utils/strings";
import { initialiseDehydrationIfEnabled } from "../../../../utils/device/dehydration.ts";
import { withSecretStorageKeyCache } from "../../../../SecurityManager";
import { EncryptionCardButtons } from "./EncryptionCardButtons";
import { logErrorAndShowErrorDialog } from "../../../../utils/ErrorUtils.tsx";
import DeviceListener, { RECOVERY_ACCOUNT_DATA_KEY } from "../../../../DeviceListener";
import { resetKeyBackupAndWait } from "../../../../utils/crypto/resetKeyBackup";

/**
 * The minimum zxcvbn score required for a security phrase.
 */
const PASSPHRASE_MIN_SCORE = 4;

/**
 * The possible states of the component.
 * - `inform_user`: The user is informed about the recovery key.
 * - `choose_method`: The user chooses between a generated recovery key and a security phrase.
 * - `enter_passphrase`: The user enters a new security phrase.
 * - `confirm_passphrase`: The user enters the security phrase a second time to confirm it.
 * - `save_key_setup_flow`: The user is asked to save the new recovery key during the setup flow.
 * - `save_key_change_flow`: The user is asked to save the new recovery key during the change key flow.
 * - `confirm_key_setup_flow`: The user is asked to confirm the new recovery key during the set up flow.
 * - `confirm_key_change_flow`: The user is asked to confirm the new recovery key during the change key flow.
 */
type State =
    | "inform_user"
    | "choose_method"
    | "enter_passphrase"
    | "confirm_passphrase"
    | "save_key_setup_flow"
    | "save_key_change_flow"
    | "confirm_key_setup_flow"
    | "confirm_key_change_flow";

interface ChangeRecoveryKeyProps {
    /**
     * If true, the component will display the flow to change the recovery key.
     * If false,the component will display the flow to set up a new recovery key.
     */
    userHasRecoveryKey: boolean;
    /**
     * Called when the recovery key is successfully changed.
     */
    onFinish: () => void;
    /**
     * Called when the cancel button is clicked or when we go back in the breadcrumbs.
     */
    onCancelClick: () => void;
}

/**
 * A component to set up or change the recovery key.
 */
export function ChangeRecoveryKey({
    userHasRecoveryKey,
    onFinish,
    onCancelClick,
}: ChangeRecoveryKeyProps): JSX.Element | null {
    const matrixClient = useMatrixClientContext();

    // If the user is setting up recovery for the first time, we first show them a panel explaining what
    // "recovery" is about. Otherwise, we jump straight to letting the user choose a key or a passphrase.
    const [state, setState] = useState<State>(userHasRecoveryKey ? "choose_method" : "inform_user");
    const [recoveryKey, setRecoveryKey] = useState<GeneratedSecretStorageKey>();
    const [passphrase, setPassphrase] = useState("");

    const setUpRecovery = async (key: GeneratedSecretStorageKey): Promise<void> => {
        const crypto = matrixClient.getCrypto();
        if (!crypto) return onFinish();

        try {
            const deviceListener = DeviceListener.sharedInstance();

            // we need to call keyStorageOutOfSyncNeedsBackupReset here because
            // deviceListener.whilePaused() sets its client to undefined, so
            // keyStorageOutOfSyncNeedsBackupReset won't be able to check
            // the backup state.
            const needsBackupReset = await deviceListener.keyStorageOutOfSyncNeedsBackupReset(true);
            await deviceListener.whilePaused(async () => {
                // We need to enable the cache to avoid to prompt the user to enter the new key
                // when we will try to access the secret storage during the bootstrap
                await withSecretStorageKeyCache(async () => {
                    await crypto.bootstrapSecretStorage({
                        setupNewSecretStorage: true,
                        createSecretStorageKey: async () => key,
                    });
                    // Reset the key backup if needed
                    if (needsBackupReset) {
                        await resetKeyBackupAndWait(crypto);
                    }
                    await initialiseDehydrationIfEnabled(matrixClient, { createNewKey: true });
                });
            });

            // Record the fact that the user explicitly enabled recovery.
            await matrixClient.setAccountData(RECOVERY_ACCOUNT_DATA_KEY, { enabled: true });

            onFinish();
        } catch (e) {
            logErrorAndShowErrorDialog("Failed to set up secret storage", e);
        }
    };

    const submitButtonLabel = userHasRecoveryKey
        ? _t("settings|encryption|recovery|change_recovery_confirm_button")
        : _t("settings|encryption|recovery|set_up_recovery_confirm_button");

    let content: JSX.Element | null = null;
    switch (state) {
        case "inform_user":
            // Show a panel explaining what "recovery" is for, and what a recovery key does.
            content = (
                <InformationPanel onContinueClick={() => setState("choose_method")} onCancelClick={onCancelClick} />
            );
            break;
        case "choose_method":
            content = (
                <ChooseMethodPanel
                    onKeyClick={async () => {
                        setRecoveryKey(await matrixClient.getCrypto()!.createRecoveryKeyFromPassphrase());
                        setState(userHasRecoveryKey ? "save_key_change_flow" : "save_key_setup_flow");
                    }}
                    onPassphraseClick={() => setState("enter_passphrase")}
                    onCancelClick={onCancelClick}
                />
            );
            break;
        case "enter_passphrase":
            content = (
                <PassphraseForm
                    passphrase={passphrase}
                    onPassphraseChange={setPassphrase}
                    onContinueClick={() => setState("confirm_passphrase")}
                    onCancelClick={onCancelClick}
                />
            );
            break;
        case "confirm_passphrase":
            content = (
                <PassphraseConfirmForm
                    passphrase={passphrase}
                    submitButtonLabel={submitButtonLabel}
                    onBackClick={() => setState("enter_passphrase")}
                    onSubmit={async () => {
                        const key = await matrixClient.getCrypto()!.createRecoveryKeyFromPassphrase(passphrase);
                        await setUpRecovery(key);
                    }}
                />
            );
            break;
        case "save_key_setup_flow":
        case "save_key_change_flow":
            if (!recoveryKey) break;
            // Show a generated recovery key and ask the user to save it.
            content = (
                <KeyPanel
                    // encodedPrivateKey is always defined, the optional typing is incorrect
                    recoveryKey={recoveryKey.encodedPrivateKey!}
                    onConfirmClick={() =>
                        setState((currentState) =>
                            currentState === "save_key_change_flow"
                                ? "confirm_key_change_flow"
                                : "confirm_key_setup_flow",
                        )
                    }
                    onCancelClick={onCancelClick}
                />
            );
            break;
        case "confirm_key_setup_flow":
        case "confirm_key_change_flow":
            if (!recoveryKey) break;
            // Ask the user to enter the recovery key they just saved to confirm it.
            content = (
                <KeyForm
                    // encodedPrivateKey is always defined, the optional typing is incorrect
                    recoveryKey={recoveryKey.encodedPrivateKey!}
                    onCancelClick={onCancelClick}
                    onSubmit={() => setUpRecovery(recoveryKey)}
                    submitButtonLabel={submitButtonLabel}
                />
            );
    }

    const pages = [
        _t("settings|encryption|title"),
        userHasRecoveryKey
            ? _t("settings|encryption|recovery|change_recovery_key")
            : _t("settings|encryption|recovery|set_up_recovery"),
    ];
    const labels = getLabels(state, userHasRecoveryKey);

    return (
        <>
            <Breadcrumb
                backLabel={_t("action|back")}
                onBackClick={onCancelClick}
                pages={pages}
                onPageClick={onCancelClick}
            />
            <EncryptionCard
                Icon={KeyIcon}
                title={labels.title}
                description={labels.description}
                className="mx_ChangeRecoveryKey"
            >
                {content}
            </EncryptionCard>
        </>
    );
}

type Labels = {
    /**
     * The title of the card.
     */
    title: string;
    /**
     * The description of the card.
     */
    description: string;
};

/**
 * Get the header title and description for the given state.
 * @param state
 * @param userHasRecoveryKey
 */
function getLabels(state: State, userHasRecoveryKey: boolean): Labels {
    switch (state) {
        case "inform_user":
            return {
                title: _t("settings|encryption|recovery|set_up_recovery"),
                description: _t("settings|encryption|recovery|set_up_recovery_description", {
                    changeRecoveryKeyButton: _t("settings|encryption|recovery|change_recovery_key"),
                }),
            };
        case "choose_method":
            return {
                title: userHasRecoveryKey
                    ? _t("settings|encryption|recovery|change_recovery_key")
                    : _t("settings|encryption|recovery|set_up_recovery"),
                description: _t("settings|key_backup|setup_secure_backup|description"),
            };
        case "enter_passphrase":
            return {
                title: _t("settings|key_backup|setup_secure_backup|enter_phrase_title"),
                description: _t("settings|key_backup|setup_secure_backup|enter_phrase_description"),
            };
        case "confirm_passphrase":
            return {
                title: _t("settings|key_backup|setup_secure_backup|confirm_security_phrase"),
                description: _t("settings|key_backup|setup_secure_backup|enter_phrase_to_confirm"),
            };
        case "save_key_setup_flow":
            return {
                title: _t("settings|encryption|recovery|set_up_recovery_save_key_title"),
                description: _t("settings|encryption|recovery|set_up_recovery_save_key_description"),
            };
        case "save_key_change_flow":
            return {
                title: _t("settings|encryption|recovery|change_recovery_key_title"),
                description: _t("settings|encryption|recovery|change_recovery_key_description"),
            };
        case "confirm_key_setup_flow":
            return {
                title: _t("settings|encryption|recovery|set_up_recovery_confirm_title"),
                description: _t("settings|encryption|recovery|set_up_recovery_confirm_description"),
            };
        case "confirm_key_change_flow":
            return {
                title: _t("settings|encryption|recovery|change_recovery_confirm_title"),
                description: _t("settings|encryption|recovery|change_recovery_confirm_description"),
            };
    }
}

interface InformationPanelProps {
    /**
     * Called when the continue button is clicked.
     */
    onContinueClick: MouseEventHandler<HTMLButtonElement>;
    /**
     * Called when the cancel button is clicked.
     */
    onCancelClick: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The panel to display information about the recovery key.
 */
function InformationPanel({ onContinueClick, onCancelClick }: InformationPanelProps): JSX.Element {
    return (
        <>
            <Text as="span" weight="medium" className="mx_InformationPanel_description">
                {_t("settings|encryption|recovery|set_up_recovery_secondary_description")}
            </Text>
            <EncryptionCardButtons>
                <Button onClick={onContinueClick}>{_t("action|continue")}</Button>
                <Button kind="tertiary" onClick={onCancelClick}>
                    {_t("action|cancel")}
                </Button>
            </EncryptionCardButtons>
        </>
    );
}

interface ChooseMethodPanelProps {
    /**
     * Called when the user chooses to generate a recovery key.
     */
    onKeyClick: () => Promise<void>;
    /**
     * Called when the user chooses to use a security phrase.
     */
    onPassphraseClick: MouseEventHandler<HTMLButtonElement>;
    /**
     * Called when the cancel button is clicked.
     */
    onCancelClick: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The panel to choose between a generated recovery key and a security phrase.
 */
function ChooseMethodPanel({ onKeyClick, onPassphraseClick, onCancelClick }: ChooseMethodPanelProps): JSX.Element {
    const [isGenerating, setIsGenerating] = useState(false);

    return (
        <>
            <div className="mx_ChooseMethodPanel">
                <Text as="span" weight="semibold">
                    {_t("settings|key_backup|setup_secure_backup|enter_phrase_title")}
                </Text>
                <Text as="span" size="sm">
                    {_t("settings|key_backup|setup_secure_backup|use_phrase_only_you_know")}
                </Text>
                <Text as="span" weight="semibold">
                    {_t("settings|key_backup|setup_secure_backup|generate_security_key_title")}
                </Text>
                <Text as="span" size="sm">
                    {_t("settings|key_backup|setup_secure_backup|generate_security_key_description")}
                </Text>
            </div>
            <EncryptionCardButtons>
                <Button type="button" onClick={onPassphraseClick} disabled={isGenerating}>
                    {_t("settings|key_backup|setup_secure_backup|enter_phrase_title")}
                </Button>
                <Button
                    type="button"
                    kind="secondary"
                    disabled={isGenerating}
                    onClick={() => {
                        setIsGenerating(true);
                        onKeyClick().finally(() => setIsGenerating(false));
                    }}
                >
                    {_t("settings|key_backup|setup_secure_backup|generate_security_key_title")}
                </Button>
                <Button type="button" kind="tertiary" onClick={onCancelClick}>
                    {_t("action|cancel")}
                </Button>
            </EncryptionCardButtons>
        </>
    );
}

interface PassphraseFormProps {
    /**
     * The security phrase entered so far.
     */
    passphrase: string;
    /**
     * Called when the security phrase changes.
     */
    onPassphraseChange: (passphrase: string) => void;
    /**
     * Called when the user submits a strong enough security phrase.
     */
    onContinueClick: () => void;
    /**
     * Called when the cancel button is clicked.
     */
    onCancelClick: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The form to enter a new security phrase.
 * The continue button is disabled until the security phrase is strong enough.
 */
function PassphraseForm({
    passphrase,
    onPassphraseChange,
    onContinueClick,
    onCancelClick,
}: PassphraseFormProps): JSX.Element {
    const [isValid, setIsValid] = useState(false);

    return (
        <form
            className="mx_PassphraseForm"
            onSubmit={(evt) => {
                evt.preventDefault();
                if (isValid) onContinueClick();
            }}
        >
            <Text as="p" size="sm" className="mx_PassphraseForm_hint">
                {_t("settings|key_backup|setup_secure_backup|phrase_requirements_hint")}
            </Text>
            <PassphraseField
                id="mx_ChangeRecoveryKey_passphrase"
                minScore={PASSPHRASE_MIN_SCORE}
                value={passphrase}
                onChange={(evt) => onPassphraseChange((evt.target as HTMLInputElement).value)}
                onValidate={(result) => setIsValid(!!result.valid)}
                autoFocus={true}
                showVisibilityToggle={true}
                label={_td("settings|key_backup|setup_secure_backup|enter_phrase_title")}
                labelEnterPassword={_td("settings|key_backup|setup_secure_backup|enter_phrase_title")}
                labelStrongPassword={_td("settings|key_backup|setup_secure_backup|phrase_strong_enough")}
                labelAllowedButUnsafe={_td("settings|key_backup|setup_secure_backup|phrase_strong_enough")}
            />
            <EncryptionCardButtons>
                <Button disabled={!isValid}>{_t("action|continue")}</Button>
                <Button type="button" kind="tertiary" onClick={onCancelClick}>
                    {_t("action|cancel")}
                </Button>
            </EncryptionCardButtons>
        </form>
    );
}

interface PassphraseConfirmFormProps {
    /**
     * The security phrase to confirm.
     */
    passphrase: string;
    /**
     * The label for the submit button.
     */
    submitButtonLabel: string;
    /**
     * Called when the back button is clicked.
     */
    onBackClick: MouseEventHandler<HTMLButtonElement>;
    /**
     * Called when the form is submitted with a matching security phrase.
     */
    onSubmit: () => Promise<void>;
}

/**
 * The form to confirm the security phrase.
 * The submit button is disabled until the entered security phrase matches.
 */
function PassphraseConfirmForm({
    passphrase,
    submitButtonLabel,
    onBackClick,
    onSubmit,
}: PassphraseConfirmFormProps): JSX.Element {
    const [confirmation, setConfirmation] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const matches = confirmation === passphrase;

    return (
        <form
            className="mx_PassphraseForm"
            onSubmit={(evt) => {
                evt.preventDefault();
                if (!matches || isSubmitting) return;
                setIsSubmitting(true);
                onSubmit().finally(() => setIsSubmitting(false));
            }}
        >
            <PassphraseConfirmField
                id="mx_ChangeRecoveryKey_passphraseConfirm"
                value={confirmation}
                password={passphrase}
                onChange={(evt) => setConfirmation((evt.target as HTMLInputElement).value)}
                autoFocus={true}
                showVisibilityToggle={true}
                label={_td("settings|key_backup|setup_secure_backup|confirm_security_phrase")}
                labelRequired={_td("settings|key_backup|setup_secure_backup|confirm_security_phrase")}
                labelInvalid={_td("settings|key_backup|setup_secure_backup|pass_phrase_match_failed")}
            />
            <EncryptionCardButtons>
                <Button disabled={!matches || isSubmitting}>{submitButtonLabel}</Button>
                <Button type="button" kind="tertiary" onClick={onBackClick} disabled={isSubmitting}>
                    {_t("action|back")}
                </Button>
            </EncryptionCardButtons>
        </form>
    );
}

interface KeyPanelProps {
    /**
     * Called when the confirm button is clicked.
     */
    onConfirmClick: MouseEventHandler;
    /**
     * Called when the cancel button is clicked.
     */
    onCancelClick: MouseEventHandler;
    /**
     * The recovery key to display.
     */
    recoveryKey: string;
}

/**
 * The panel to display the recovery key.
 */
function KeyPanel({ recoveryKey, onConfirmClick, onCancelClick }: KeyPanelProps): JSX.Element {
    return (
        <>
            <div className="mx_KeyPanel">
                <Text as="span" weight="medium">
                    {_t("settings|encryption|recovery|save_key_title")}
                </Text>
                <div>
                    <Text as="span" className="mx_KeyPanel_key" data-testid="recoveryKey">
                        {recoveryKey}
                    </Text>
                    <Text as="span" size="sm">
                        {_t("settings|encryption|recovery|save_key_description")}
                    </Text>
                </div>
                <IconButton aria-label={_t("action|copy")} size="28px" onClick={() => copyPlaintext(recoveryKey)}>
                    <CopyIcon />
                </IconButton>
            </div>
            <EncryptionCardButtons>
                <Button onClick={onConfirmClick}>{_t("action|continue")}</Button>
                <Button kind="tertiary" onClick={onCancelClick}>
                    {_t("action|cancel")}
                </Button>
            </EncryptionCardButtons>
        </>
    );
}

interface KeyFormProps {
    /**
     * Called when the cancel button is clicked.
     */
    onCancelClick: MouseEventHandler;
    /**
     * Called when the form is submitted.
     */
    onSubmit: () => Promise<void>;
    /**
     * The recovery key to confirm.
     */
    recoveryKey: string;
    /**
     * The label for the submit button.
     */
    submitButtonLabel: string;
}

/**
 * The form to confirm the recovery key.
 * The finish button is disabled until the key is filled and valid.
 * The entered key is valid if it matches the recovery key.
 */
function KeyForm({ onCancelClick, onSubmit, recoveryKey, submitButtonLabel }: KeyFormProps): JSX.Element {
    // Undefined by default, as the key is not filled yet
    const [isKeyValid, setIsKeyValid] = useState<boolean>();
    const [isKeyChangeInProgress, setIsKeyChangeInProgress] = useState<boolean>(false);
    const isKeyInvalidAndFilled = isKeyValid === false;

    return (
        <Root
            className="mx_KeyForm"
            onSubmit={(evt) => {
                evt.preventDefault();
                if (isKeyChangeInProgress) {
                    // Don't allow repeated attempts.
                    return;
                }
                setIsKeyChangeInProgress(true);
                onSubmit().finally(() => {
                    setIsKeyChangeInProgress(false);
                });
            }}
            onChange={async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();

                // We don't have any file in the form, we can cast it as string safely
                const filledKey = new FormData(evt.currentTarget).get("recoveryKey") as string | "";
                setIsKeyValid(filledKey.trim() === recoveryKey);
            }}
        >
            <Field name="recoveryKey" serverInvalid={isKeyInvalidAndFilled}>
                <Label>{_t("settings|encryption|recovery|enter_recovery_key")}</Label>

                <PasswordControl
                    required={true}
                    title={_t("settings|encryption|recovery|enter_recovery_key")}
                    className="mx_KeyForm_password mx_no_textinput"
                />
                {isKeyInvalidAndFilled && (
                    <ErrorMessage>{_t("settings|encryption|recovery|enter_key_error")}</ErrorMessage>
                )}
            </Field>
            <EncryptionCardButtons>
                <Button disabled={!isKeyValid || isKeyChangeInProgress}>{submitButtonLabel}</Button>
                <Button kind="tertiary" onClick={onCancelClick}>
                    {_t("action|cancel")}
                </Button>
            </EncryptionCardButtons>
        </Root>
    );
}

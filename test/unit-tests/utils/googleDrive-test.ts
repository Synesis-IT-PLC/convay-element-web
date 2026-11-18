/*
 * Copyright 2025 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
 * Please see LICENSE files in the repository root for full details.
 */

import SdkConfig from "../../../src/SdkConfig";
import { getGoogleDriveClientId, saveRecoveryKeyToGoogleDrive } from "../../../src/utils/googleDrive";

describe("googleDrive", () => {
    beforeEach(() => {
        SdkConfig.reset();
        SdkConfig.put({
            brand: "Test",
        } as any);
        delete (window as any).google;
        document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((el) => el.remove());
    });

    describe("getGoogleDriveClientId", () => {
        it("returns undefined when not configured", () => {
            expect(getGoogleDriveClientId()).toBeUndefined();
        });

        it("returns the configured client id", () => {
            SdkConfig.put({
                brand: "Test",
                google_drive: { client_id: " abc.apps.googleusercontent.com " },
            } as any);
            expect(getGoogleDriveClientId()).toBe("abc.apps.googleusercontent.com");
        });

        it("returns undefined for blank client id", () => {
            SdkConfig.put({
                brand: "Test",
                google_drive: { client_id: "   " },
            } as any);
            expect(getGoogleDriveClientId()).toBeUndefined();
        });
    });

    describe("saveRecoveryKeyToGoogleDrive", () => {
        it("throws when Google Drive is not configured", async () => {
            await expect(saveRecoveryKeyToGoogleDrive("key", "recovery-key-user.txt")).rejects.toThrow(
                "Google Drive is not configured",
            );
        });

        it("requests a token and uploads the file", async () => {
            SdkConfig.put({
                brand: "Test",
                google_drive: { client_id: "client-id.apps.googleusercontent.com" },
            } as any);

            const requestAccessToken = jest.fn();
            (window as any).google = {
                accounts: {
                    oauth2: {
                        initTokenClient: jest.fn(({ callback }) => {
                            // Simulate successful auth when requestAccessToken is called
                            requestAccessToken.mockImplementation(() => {
                                callback({ access_token: "token-123" });
                            });
                            return { requestAccessToken };
                        }),
                    },
                },
            };

            const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                text: async () => "",
            } as Response);

            await saveRecoveryKeyToGoogleDrive("encoded-key", "recovery-key-user.txt");

            expect(requestAccessToken).toHaveBeenCalled();
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
                expect.objectContaining({
                    method: "POST",
                    headers: { Authorization: "Bearer token-123" },
                    body: expect.any(FormData),
                }),
            );

            fetchSpy.mockRestore();
        });
    });
});

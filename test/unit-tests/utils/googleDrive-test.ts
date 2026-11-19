/*
 * Copyright 2025 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
 * Please see LICENSE files in the repository root for full details.
 */

import SdkConfig from "../../../src/SdkConfig";
import {
    getGoogleDriveClientId,
    getRecoveryKeyFilename,
    GoogleDriveRecoveryKeyNotFoundError,
    restoreRecoveryKeyFromGoogleDrive,
    saveRecoveryKeyToGoogleDrive,
} from "../../../src/utils/googleDrive";

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

    describe("getRecoveryKeyFilename", () => {
        it("uses the matrix localpart", () => {
            expect(getRecoveryKeyFilename("@alice:example.com")).toBe("recovery-key-alice.txt");
        });
    });

    describe("restoreRecoveryKeyFromGoogleDrive", () => {
        function mockGoogleAuth(): void {
            const requestAccessToken = jest.fn();
            (window as any).google = {
                accounts: {
                    oauth2: {
                        initTokenClient: jest.fn(({ callback }) => {
                            requestAccessToken.mockImplementation(() => {
                                callback({ access_token: "token-123" });
                            });
                            return { requestAccessToken };
                        }),
                    },
                },
            };
        }

        it("downloads the newest matching recovery key file", async () => {
            SdkConfig.put({
                brand: "Test",
                google_drive: { client_id: "client-id.apps.googleusercontent.com" },
            } as any);
            mockGoogleAuth();

            const fetchSpy = jest
                .spyOn(global, "fetch")
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ files: [{ id: "file-1" }] }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: async () => "  encoded private key  ",
                } as Response);

            await expect(restoreRecoveryKeyFromGoogleDrive("recovery-key-userId.txt")).resolves.toBe(
                "encoded private key",
            );

            expect(fetchSpy).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("https://www.googleapis.com/drive/v3/files?"),
                expect.objectContaining({
                    headers: { Authorization: "Bearer token-123" },
                }),
            );
            expect(fetchSpy).toHaveBeenNthCalledWith(
                2,
                "https://www.googleapis.com/drive/v3/files/file-1?alt=media",
                expect.objectContaining({
                    headers: { Authorization: "Bearer token-123" },
                }),
            );

            fetchSpy.mockRestore();
        });

        it("throws when no recovery key file is found", async () => {
            SdkConfig.put({
                brand: "Test",
                google_drive: { client_id: "client-id.apps.googleusercontent.com" },
            } as any);
            mockGoogleAuth();

            const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                json: async () => ({ files: [] }),
            } as Response);

            await expect(restoreRecoveryKeyFromGoogleDrive("recovery-key-userId.txt")).rejects.toBeInstanceOf(
                GoogleDriveRecoveryKeyNotFoundError,
            );

            fetchSpy.mockRestore();
        });
    });
});

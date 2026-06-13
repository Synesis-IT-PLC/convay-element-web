import SdkConfig from "../SdkConfig";

const BCC_FAVICON_180 = "vector-icons/180_uct.png";
const BCC_FAVICON_520 = "vector-icons/520_uct.png";

export function applyEnvFavicon(): void {
    if (SdkConfig.get("env") !== "bcc-live") {
        return;
    }

    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
        if (link.getAttribute("sizes") === "512x512") {
            link.href = BCC_FAVICON_520;
        } else {
            link.href = BCC_FAVICON_180;
        }
    });
}

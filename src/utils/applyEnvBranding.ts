import SdkConfig from "../SdkConfig";

const BCC_FAVICON_180 = "vector-icons/180_uct.png";
const BCC_FAVICON_520 = "vector-icons/520_uct.png";
const DEFAULT_OG_IMAGE = "vector-icons/520.png";
const BCC_OG_IMAGE = "vector-icons/520_uct.png";

function resolveOgImagePath(): string {
    const configured = SdkConfig.getObject("branding")?.get("og_image_url");
    if (configured) {
        return configured;
    }

    if (SdkConfig.get("env") === "bcc-live") {
        return BCC_OG_IMAGE;
    }

    return DEFAULT_OG_IMAGE;
}

function toAbsoluteUrl(path: string): string {
    return new URL(path, window.location.origin).href;
}

function applyEnvFavicon(): void {
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

function applyOgImage(): void {
    const ogImageUrl = toAbsoluteUrl(resolveOgImagePath());
    let meta = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
    if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("property", "og:image");
        document.head.appendChild(meta);
    }
    meta.content = ogImageUrl;
}

export function applyEnvBranding(): void {
    applyEnvFavicon();
    applyOgImage();
}

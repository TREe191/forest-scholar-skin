export const PREVIEW_SCHEME = "skin-preview";

export function registerPreviewScheme(protocolModule) {
  protocolModule.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ]);
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function installPreviewProtocol(protocolModule, catalog, drafts) {
  protocolModule.handle(PREVIEW_SCHEME, (request) => {
    let url;
    try { url = new URL(request.url); }
    catch { return notFound(); }
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (!['theme','draft'].includes(url.hostname) || segments.length !== 2) return notFound();
    const [themeId, variant] = segments;
    const asset = url.hostname==='draft' ? (variant==='image' ? drafts?.asset(themeId) : null) : catalog.getPreviewAsset(themeId, variant);
    if (!asset) return notFound();
    return new Response(asset.bytes, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

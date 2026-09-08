import test from "node:test";
import assert from "node:assert/strict";
import { installPreviewProtocol, registerPreviewScheme } from "../src/main/preview-protocol.mjs";

test("registers skin-preview as a standard secure scheme", () => {
  let registration;
  registerPreviewScheme({ registerSchemesAsPrivileged(value) { registration = value; } });
  assert.equal(registration[0].scheme, "skin-preview");
  assert.equal(registration[0].privileges.standard, true);
  assert.equal(registration[0].privileges.secure, true);
  assert.equal(registration[0].privileges.corsEnabled, false);
});

test("serves only validated catalog assets without filesystem paths", async () => {
  let handler;
  const protocol = { handle(scheme, value) { assert.equal(scheme, "skin-preview"); handler = value; } };
  const catalog = {
    getPreviewAsset(themeId, variant) {
      if (themeId === "phainon" && variant === "light") {
        return { bytes: Buffer.from("validated-image"), mimeType: "image/png" };
      }
      return null;
    },
  };
  installPreviewProtocol(protocol, catalog);
  const valid = await handler({ url: "skin-preview://theme/phainon/light" });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("content-type"), "image/png");
  assert.equal(await valid.text(), "validated-image");
  const invalid = await handler({ url: "skin-preview://theme/../../config/app.json" });
  assert.equal(invalid.status, 404);
});

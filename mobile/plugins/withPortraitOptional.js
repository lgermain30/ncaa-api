const { withAndroidManifest } = require("expo/config-plugins");

// expo.orientation = "portrait" makes Play treat android.hardware.screen.portrait
// as required, which blocks installs on some tablets/foldables. Declare it optional.
module.exports = function withPortraitOptional(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-feature"] = (manifest["uses-feature"] ?? []).filter(
      (f) => f.$["android:name"] !== "android.hardware.screen.portrait",
    );
    manifest["uses-feature"].push({
      $: {
        "android:name": "android.hardware.screen.portrait",
        "android:required": "false",
      },
    });
    return cfg;
  });
};

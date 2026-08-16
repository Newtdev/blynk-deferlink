// Android: no native code ships in this package for that platform — the
// optional Install Referrer native module is provided by the app's own
// dependency when present.
//
// iOS: as of the clipboard deterministic-recovery tier, this package DOES
// ship real native code (ReferralMobilePasteControl.podspec, ios/*.swift) —
// intentionally left un-nulled so autolinking picks up the podspec.
module.exports = {
  dependency: {
    platforms: {
      android: null,
    },
  },
};

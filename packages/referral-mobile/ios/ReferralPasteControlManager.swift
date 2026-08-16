import React
import UIKit

/// Registers ReferralPasteControlView with RN's bridge. The `@available`
/// guard lives here, not just on the view class: this manager itself is
/// instantiated unconditionally by RN regardless of OS version (the JS
/// side has no compile-time notion of Swift availability), so `view()`
/// has to degrade gracefully below iOS 16 rather than crash.
@objc(ReferralPasteControlManager)
class ReferralPasteControlManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func view() -> UIView! {
    if #available(iOS 16.0, *) {
      return ReferralPasteControlView()
    }
    // Below iOS 16: UIPasteControl doesn't exist. An inert, zero-size view
    // — the JS side never receives onPaste and falls back to fingerprint
    // matching, same as if the user had declined a permission prompt.
    return UIView()
  }
}

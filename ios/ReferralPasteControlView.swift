import React
import UIKit

/// Wraps `UIPasteControl` — a system-provided paste button that grants
/// clipboard read access without the iOS 16+ "would like to paste" system
/// prompt, because the user's tap on this control *is* the explicit
/// consent. `UIView`/`UIResponder` already conforms to
/// `UIPasteConfigurationSupporting` (with real, working storage for
/// `pasteConfiguration`, not just a protocol stub) as of iOS 11, so no
/// extra conformance declaration is needed here — just the `paste`
/// override.
///
/// Deliberately minimal: this view's only job is "get me the pasted
/// string." Payload validation (the `sparkle_ref:v1:` prefix, staleness
/// against the match window) lives in JS (see clipboardPayload.ts) where
/// it's shared, testable logic instead of duplicated in Swift.
@available(iOS 16.0, *)
class ReferralPasteControlView: UIView {
  @objc var onPaste: RCTDirectEventBlock?

  private let pasteControl: UIPasteControl
  // Only used for the narrow "is it safe to clear the clipboard" check
  // below — full format/staleness validation stays in JS either way.
  private let payloadPrefix = "sparkle_ref:v1:"

  override init(frame: CGRect) {
    pasteControl = UIPasteControl(configuration: UIPasteControl.Configuration())
    super.init(frame: frame)

    // Set on self (the target UIPasteControl reports to), not on the
    // control itself — pasteConfiguration lives on UIResponder/UIView,
    // it's what UIPasteControl checks against the current pasteboard
    // contents to decide whether it's enabled at all.
    self.pasteConfiguration = UIPasteConfiguration(forAccepting: String.self)
    pasteControl.target = self
    addSubview(pasteControl)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    pasteControl.frame = bounds
  }

  override func paste(itemProviders: [NSItemProvider]) {
    guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: String.self) }) else {
      return
    }

    _ = provider.loadObject(ofClass: String.self) { [weak self] object, _ in
      guard let text = object else { return }
      DispatchQueue.main.async {
        guard let self else { return }
        self.onPaste?(["text": text])
        // Clear it once read, so it can't linger and get pasted somewhere
        // unrelated by accident later. Only clear what's plausibly ours —
        // never wipe a user's actual clipboard content just because they
        // tapped this button and it happened to hold something else.
        if text.hasPrefix(self.payloadPrefix) {
          UIPasteboard.general.items = []
        }
      }
    }
  }
}

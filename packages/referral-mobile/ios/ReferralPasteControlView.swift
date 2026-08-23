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

  // Theming, all optional and all backed by real `UIPasteControl.Configuration`
  // fields (verified against the iOS 16 SDK — its actual surface is much
  // narrower than UIButton.Configuration: no custom image, font, or label
  // text, since the button's icon+text is a fixed system promise that's
  // part of why it can skip the "would like to paste" prompt at all).
  // Named `paste*`, not `tintColor`/`backgroundColor`, to avoid shadowing
  // UIView's own built-in properties of those names.
  @objc var pasteForegroundColor: UIColor? { didSet { rebuildControl() } }
  @objc var pasteBackgroundColor: UIColor? { didSet { rebuildControl() } }
  @objc var cornerStyle: NSString? { didSet { rebuildControl() } }
  @objc var displayMode: NSString? { didSet { rebuildControl() } }

  private var pasteControl: UIPasteControl
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

  // UIPasteControl's `configuration` is get-only after init — there's no
  // setter to restyle one in place (confirmed by trying it against the
  // real SDK, not documented). Restyling means building a new instance
  // with the updated Configuration and swapping it in; `paste(itemProviders:)`
  // below is unaffected since it fires via the responder chain on `self`
  // (the `target`), not per-control-instance state.
  private func rebuildControl() {
    let config = UIPasteControl.Configuration()
    config.baseForegroundColor = pasteForegroundColor
    config.baseBackgroundColor = pasteBackgroundColor
    config.cornerStyle = Self.parseCornerStyle(cornerStyle as String?)
    config.displayMode = Self.parseDisplayMode(displayMode as String?)

    let newControl = UIPasteControl(configuration: config)
    newControl.target = self
    newControl.frame = bounds
    pasteControl.removeFromSuperview()
    pasteControl = newControl
    addSubview(pasteControl)
  }

  private static func parseCornerStyle(_ raw: String?) -> UIButton.Configuration.CornerStyle {
    switch raw {
    case "fixed": return .fixed
    case "capsule": return .capsule
    case "large": return .large
    case "medium": return .medium
    case "small": return .small
    default: return .dynamic
    }
  }

  private static func parseDisplayMode(_ raw: String?) -> UIPasteControl.DisplayMode {
    switch raw {
    case "iconOnly": return .iconOnly
    case "labelOnly": return .labelOnly
    default: return .iconAndLabel
    }
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

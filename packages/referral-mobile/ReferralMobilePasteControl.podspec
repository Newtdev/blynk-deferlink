require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Separate from the JS package name deliberately — CocoaPods podspec names
# share a single global namespace across all pods in a project, so this is
# scoped/prefixed to avoid colliding with anything else named "referral-*"
# in a consuming app's other dependencies.
Pod::Spec.new do |s|
  s.name         = "ReferralMobilePasteControl"
  s.version      = package["version"]
  s.summary      = "UIPasteControl bridge for @blynk-deferlink/referral-mobile's deterministic iOS deferred deep linking."
  s.homepage     = "https://github.com/Newtdev/blynk-deferlink"
  s.license      = package["license"]
  s.authors      = { "Thomas Ejembi" => "" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/Newtdev/blynk-deferlink.git" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.swift_version = "5.0"

  s.dependency "React-Core"
end

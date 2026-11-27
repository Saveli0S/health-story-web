#!/bin/bash
# Run against an isolated signed QA bundle. Requires Xcode, playwright-core, Chrome and an active family setup code.
set -euo pipefail
: "${HS_DEVICE:?Specify an iPhone device ID or booted simulator UDID}"
: "${HS_SETUP_FILE:?Specify the path to the Cloudflare family setup code}"
root=$(cd "$(dirname "$0")/../.." && pwd)
run=$(mktemp -d "${TMPDIR:-/tmp}/hs-native-e2e.XXXXXX")
chmod 700 "$run"
mkdir -p "$run/ios" "$run/assets/app"
cp -R "$root/ios/HealthStory" "$root/ios/HealthStory.xcodeproj" "$root/ios/HealthStory.xcconfig" "$root/ios/HealthStory-Info.plist" "$run/ios/"
cp "$root/treatment.js" "$run/"
cp "$root/assets/app/prompt-defaults.js" "$root/assets/app/privacy.js" "$root/assets/app/clinical-parser.js" "$root/assets/app/sync-merge.js" "$root/assets/app/record-removal.js" "$run/assets/app/"
sed -i '' '/^@main$/d' "$run/ios/HealthStory/HealthStoryApp.swift"
cp "$root/tests/native-device/SmokeApp.swift" "$run/ios/HealthStory/"
bundle=by.healthstory.devicecheck
if [[ "${HS_SIMULATOR:-0}" == 1 ]]; then
  dest="platform=iOS Simulator,id=$HS_DEVICE"
  signing=(CODE_SIGNING_ALLOWED=YES)
  platform=iphonesimulator
else
  : "${HS_TEAM:?Specify your personal development team}"
  dest="platform=iOS,id=$HS_DEVICE"
  signing=(DEVELOPMENT_TEAM="$HS_TEAM" -allowProvisioningUpdates)
  platform=iphoneos
fi
packages=()
if [[ -n "${HS_SWIFT_PACKAGES:-}" ]]; then
  packages=(-clonedSourcePackagesDirPath "$HS_SWIFT_PACKAGES")
fi
if [[ -f "$root/ios/GoogleDrive.xcconfig" ]]; then
  cp "$root/ios/GoogleDrive.xcconfig" "$run/ios/"
fi
xcodebuild "${packages[@]}" -project "$run/ios/HealthStory.xcodeproj" -scheme HealthStory -configuration Debug -destination "$dest" -derivedDataPath "$run/build" PRODUCT_BUNDLE_IDENTIFIER="$bundle" "${signing[@]}" build > "$run/build.log" 2>&1 || { tail -24 "$run/build.log";exit 1; }
app="$run/build/Build/Products/Debug-$platform/HealthStory.app"
if [[ "${HS_SIMULATOR:-0}" == 1 ]]; then
  xcrun simctl install "$HS_DEVICE" "$app"
else
  xcrun devicectl device install app --device "$HS_DEVICE" "$app"
fi
node "$root/tests/native-device/web-roundtrip.cjs" "$run"

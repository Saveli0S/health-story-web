#!/bin/bash
set -euo pipefail

usage() {
  printf 'Usage: %s DEVICE_UDID APPLE_TEAM_ID [--build-only | --install-only | --verify-only]\n' "$0"
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

device_id=$1
team_id=$2
mode=${3:-}
case "$mode" in
  ''|--build-only|--install-only|--verify-only) ;;
  *) usage >&2; exit 2 ;;
esac
bundle_id=by.healthstory.familyjournal
ios_dir=$(cd "$(dirname "$0")" && pwd)
build_dir="$HOME/Library/Caches/HealthStory/FamilyBuild"

check_installed() {
  xcrun devicectl device info apps --device "$device_id" --timeout 15 --include-all-apps --quiet --json-output - | python3 -c '
import json, sys

bundle, expected_build = sys.argv[1:]
apps = json.load(sys.stdin)["result"]["apps"]
installed = [app for app in apps if app.get("bundleIdentifier") == bundle]
if len(installed) != 1:
    sys.exit("Не удалось подтвердить установку «Листа здоровья» на iPhone.")
app = installed[0]
build = str(app.get("bundleVersion", ""))
if expected_build and build != expected_build:
    sys.exit(f"На iPhone установлена сборка {build}, ожидалась {expected_build}.")
print(f"Лист здоровья — сборка {build}")

copies = [row for row in apps if row.get("bundleIdentifier") != bundle and (
    str(row.get("bundleIdentifier", "")).lower().startswith("by.healthstory.")
    or str(row.get("name", "")).casefold().startswith(("лист здоровья", "health story"))
)]
if copies:
    print("Отдельные копии дневника на iPhone:")
    for row in copies:
        name = row.get("name", "")
        identifier = row.get("bundleIdentifier", "")
        print(f"  {name} ({identifier})")
else:
    print("На iPhone одна копия «Листа здоровья».")
' "$bundle_id" "${1:-}"
}

if [[ "$mode" != "--install-only" && "$mode" != "--verify-only" ]]; then
  destination="platform=iOS,id=$device_id"
  if [[ "$mode" == "--build-only" ]]; then
    destination="generic/platform=iOS"
  fi
  xcodebuild -quiet -project "$ios_dir/HealthStory.xcodeproj" -scheme HealthStory \
    -configuration Debug -destination "$destination" \
    -derivedDataPath "$build_dir" DEVELOPMENT_TEAM="$team_id" \
    -allowProvisioningUpdates build
fi

app="$build_dir/Build/Products/Debug-iphoneos/HealthStory.app"
if [[ ! -d "$app" ]]; then
  printf 'No prepared build. Run with --build-only first.\n' >&2
  exit 1
fi
actual_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
if [[ "$actual_id" != "$bundle_id" ]]; then
  printf 'Unexpected app identifier: %s\n' "$actual_id" >&2
  exit 1
fi
codesign --verify --strict "$app"
actual_team=$(codesign -dv "$app" 2>&1 | awk -F= '$1 == "TeamIdentifier" {print $2}')
if [[ "$actual_team" != "$team_id" ]]; then
  printf 'Expected the app to be signed by the supplied Apple team.\n' >&2
  exit 1
fi
security cms -D -i "$app/embedded.mobileprovision" | python3 -c '
import datetime, plistlib, sys
device, team, bundle = sys.argv[1:]
p=plistlib.loads(sys.stdin.buffer.read())
if p["Entitlements"].get("application-identifier") != f"{team}.{bundle}":
    sys.exit("The provisioning profile belongs to a different team or app.")
if device.casefold() not in {udid.casefold() for udid in p.get("ProvisionedDevices", [])}:
    sys.exit("The provisioning profile does not include this iPhone. Connect it and select it in Xcode.")
expires=p["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
if expires <= datetime.datetime.now(datetime.timezone.utc):
    sys.exit("The signing profile expired. Renew it in Xcode.")
print("Signing profile valid through " + expires.strftime("%Y-%m-%d %H:%M UTC"))
' "$device_id" "$team_id" "$bundle_id"
if [[ "$mode" == "--build-only" || "$mode" == "--verify-only" ]]; then
  printf '%s\n' "$app"
  if [[ "$mode" == "--verify-only" ]]; then check_installed; fi
  exit 0
fi

expected_build=$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$app/Info.plist")
xcrun devicectl device install app --device "$device_id" "$app"
check_installed "$expected_build"

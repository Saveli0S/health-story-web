#!/bin/bash
set -euo pipefail

usage() {
  printf 'Использование: %s [--check]\n' "$0"
}

case "${1:-}" in
  --help) usage; exit 0 ;;
  ''|--check) ;;
  *) usage >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then usage >&2; exit 2; fi

ios_dir=$(cd "$(dirname "$0")" && pwd)
device_name=${HEALTH_STORY_IPHONE:-DiorkaPro}
settings="$HOME/Library/Application Support/HealthStory/iPhone Installer"
team_file="$settings/SigningTeam"
app="$HOME/Library/Caches/HealthStory/FamilyBuild/Build/Products/Debug-iphoneos/HealthStory.app"

if [[ -f "$team_file" ]]; then
  team=$(<"$team_file")
elif [[ -d "$app" ]]; then
  team=$(codesign -dv "$app" 2>&1 | awk -F= '$1 == "TeamIdentifier" {print $2}')
else
  printf 'Команда подписи ещё не определена. Сначала соберите проект в Xcode с прежней Personal Team.\n' >&2
  exit 1
fi
if [[ ! "$team" =~ ^[A-Z0-9]{10}$ ]]; then
  printf 'Не удалось определить прежнюю команду подписи. Проверьте Signing & Capabilities в Xcode.\n' >&2
  exit 1
fi

printf 'Ищу %s…\n' "$device_name"
device=$(xcrun devicectl list devices --timeout 12 --quiet --json-output - | python3 -c '
import json, sys

name = sys.argv[1]
matches = []
for device in json.load(sys.stdin)["result"]["devices"]:
    properties = device.get("properties", {})
    state = properties.get("state", device.get("deviceProperties", {}))
    hardware = properties.get("hardware", device.get("hardwareProperties", {}))
    connection = properties.get("connection", device.get("connectionProperties", {}))
    if state.get("name") == name and hardware.get("platform") == "iOS" and connection.get("pairingState") == "paired":
        if hardware.get("udid"):
            matches.append(hardware["udid"])
if len(matches) != 1:
    sys.exit(f"Xcode должен видеть один доверенный iPhone с именем {name}. Проверьте подключение.")
print(matches[0])
' "$device_name")

if [[ "${1:-}" == '--check' ]]; then
  "$ios_dir/install-family.sh" "$device" "$team" --verify-only
else
  printf 'Собираю и обновляю «Лист здоровья» поверх установленной версии…\n'
  "$ios_dir/install-family.sh" "$device" "$team"
  printf 'Обновление установлено. Можно открыть «Лист здоровья» на iPhone.\n'
fi

if [[ ! -f "$team_file" ]]; then
  (umask 077; mkdir -p "$settings"; printf '%s\n' "$team" > "$team_file")
fi

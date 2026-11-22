#!/bin/bash
# Runs inside a clean distribution container as root: install an ASTAROT deb or rpm with the
# distribution's own tool, check what it installed and that the bundled programs start, then
# remove it. Recommended packages are left out, so only the declared requirements are present.
# With a second argument, a stand-in of the package up to 0.6.x (vrct-vox, made by
# tools/ci/legacy_linux_packages.py) goes in first, and the package of this version has to
# replace it (ADR-014, 2.7).
#   check_linux_package.sh /packages/ASTAROT-<version>-linux-x64-release.deb [/legacy/vrct-vox.deb]
set -euo pipefail
package=$1
legacy=${2-}
kind=${package##*.}
install_package() {
    case "$kind" in
        deb)
            export DEBIAN_FRONTEND=noninteractive
            apt-get install -y -qq --no-install-recommends "$1" > /dev/null
            ;;
        rpm)
            dnf install -y -q --setopt=install_weak_deps=False "$1" > /dev/null
            ;;
    esac
}
installed() {
    case "$kind" in
        deb) dpkg-query -W -f='${Status}\n' "$1" 2>/dev/null | grep -q ' ok installed$' ;;
        rpm) rpm -q "$1" > /dev/null 2>&1 ;;
    esac
}
case "$kind" in
    deb) apt-get update -qq ;;
    rpm) ;;
    *)
        echo "unknown package format: $package" >&2
        exit 2
        ;;
esac
if [ -n "$legacy" ]; then
    install_package "$legacy"
    installed vrct-vox
    test -x /usr/bin/vrct-vox
    test -f /usr/share/applications/vrct-vox.desktop
fi
install_package "$package"
installed astarot
# The package up to 0.6.x is gone, with its files: one ASTAROT in the app list.
if installed vrct-vox; then
    echo "vrct-vox is still installed beside astarot" >&2
    exit 1
fi
test ! -e /opt/vrct-vox
test ! -e /usr/share/applications/vrct-vox.desktop
test ! -e /usr/share/icons/hicolor/256x256/apps/vrct-vox.png
test "$(grep -l '^Name=ASTAROT$' /usr/share/applications/*.desktop | wc -l)" = 1
# The command the desktop entry starts; the one up to 0.6.x while the packages keep it
# (LEGACY_COMMAND_UNTIL in tools/linux_packages.py).
test -x /usr/bin/astarot
if [ -e /usr/bin/vrct-vox ]; then
    grep -q '/opt/astarot/astarot' /usr/bin/vrct-vox
fi
test -f /usr/share/applications/astarot.desktop
grep -qx 'Exec=astarot' /usr/share/applications/astarot.desktop
grep -qx 'Icon=astarot' /usr/share/applications/astarot.desktop
test -f /usr/share/icons/hicolor/256x256/apps/astarot.png
test "$(cat /opt/astarot/package-manager)" = "$kind"
# The GUI binary's libraries all resolve from the declared requirements.
missing=$(ldd /opt/astarot/astarot | grep 'not found' || true)
if [ -n "$missing" ]; then
    echo "$missing" >&2
    exit 1
fi
# Both bundled speech engines start. The backend runs inside astarot, whose libraries are
# checked above; starting the GUI needs a display and is left to the AppImage and tar.gz tests.
# The CPU build needs only the declared requirements.
/opt/astarot/_internal/build/speechcpp-cpu/speech --help > /dev/null
# The Vulkan build needs the Vulkan loader, which is only recommended: without it the app runs
# "auto" on the CPU build. Install the loader the way a user would, then start the Vulkan build.
if ldd /opt/astarot/_internal/build/speechcpp/speech | grep -q 'libvulkan.so.1 => not found'; then
    case "$kind" in
        deb) apt-get install -y -qq --no-install-recommends libvulkan1 > /dev/null ;;
        rpm) dnf install -y -q --setopt=install_weak_deps=False vulkan-loader > /dev/null ;;
    esac
fi
/opt/astarot/_internal/build/speechcpp/speech --help > /dev/null
# The installed tree is the package's: removing it leaves nothing behind.
case "$kind" in
    deb) apt-get remove -y -qq astarot > /dev/null ;;
    rpm) dnf remove -y -q astarot > /dev/null ;;
esac
test ! -e /opt/astarot
test ! -e /usr/bin/astarot
test ! -e /usr/bin/vrct-vox
test ! -e /usr/share/applications/astarot.desktop
echo "package check passed: $(basename "$package")${legacy:+ (replacing $(basename "$legacy"))} in $(. /etc/os-release && echo "$PRETTY_NAME")"

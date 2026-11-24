#!/bin/bash
# Runs inside a clean distribution container as root: install a VRCT-VOX deb or rpm with the
# distribution's own tool, check what it installed and that the bundled programs start, then
# remove it. Recommended packages are left out, so only the declared requirements are present.
#   check_linux_package.sh /packages/VRCT-VOX-<version>-linux-x64-release.deb
set -euo pipefail
package=$1
kind=${package##*.}
case "$kind" in
    deb)
        export DEBIAN_FRONTEND=noninteractive
        apt-get -o Acquire::Retries=3 update -qq
        apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends "$package" > /dev/null
        ;;
    rpm)
        dnf install -y -q --setopt=install_weak_deps=False "$package" > /dev/null
        ;;
    *)
        echo "unknown package format: $package" >&2
        exit 2
        ;;
esac
# The command the desktop entry starts, and the one up to 0.6.x.
test -x /usr/bin/astarot
test -x /usr/bin/vrct-vox
test -f /usr/share/applications/vrct-vox.desktop
grep -qx 'Exec=astarot' /usr/share/applications/vrct-vox.desktop
test -f /usr/share/icons/hicolor/256x256/apps/vrct-vox.png
test "$(cat /opt/vrct-vox/package-manager)" = "$kind"
# The GUI binary's libraries all resolve from the declared requirements.
missing=$(ldd /opt/vrct-vox/astarot | grep 'not found' || true)
if [ -n "$missing" ]; then
    echo "$missing" >&2
    exit 1
fi
# Both bundled speech engines start. The backend runs inside astarot, whose libraries are
# checked above; starting the GUI needs a display and is left to the AppImage and tar.gz tests.
# The CPU build needs only the declared requirements.
/opt/vrct-vox/_internal/build/speechcpp-cpu/speech --help > /dev/null
# The Vulkan build needs the Vulkan loader, which is only recommended: without it the app runs
# "auto" on the CPU build. Install the loader the way a user would, then start the Vulkan build.
if ldd /opt/vrct-vox/_internal/build/speechcpp/speech | grep -q 'libvulkan.so.1 => not found'; then
    case "$kind" in
        deb) apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends libvulkan1 > /dev/null ;;
        rpm) dnf install -y -q --setopt=install_weak_deps=False vulkan-loader > /dev/null ;;
    esac
fi
/opt/vrct-vox/_internal/build/speechcpp/speech --help > /dev/null
# The installed tree is the package's: removing it leaves nothing behind.
case "$kind" in
    deb) apt-get remove -y -qq vrct-vox > /dev/null ;;
    rpm) dnf remove -y -q vrct-vox > /dev/null ;;
esac
test ! -e /opt/vrct-vox
test ! -e /usr/bin/astarot
test ! -e /usr/bin/vrct-vox
echo "package check passed: $(basename "$package") in $(. /etc/os-release && echo "$PRETTY_NAME")"

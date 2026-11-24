"""deb and rpm packages from a Linux candidate (tools/linux_packages.py).

dpkg-deb and rpmbuild run in the Linux candidate workflow, which also installs both packages in
clean containers (tools/ci/check_linux_package.sh). These tests cover what is decided in Python.
"""
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import linux_packages as lp  # noqa: E402


@pytest.fixture
def candidate(tmp_path):
    root = tmp_path / "ASTAROT"
    (root / "_internal").mkdir(parents=True)
    (root / "astarot").write_bytes(b"\x7fELF main")
    (root / "vrct-vox-sidecar").write_bytes(b"\x7fELF sidecar")
    (root / "_internal/libexample.so").write_bytes(b"\x7fELF lib")
    manifest = {"version": "0.3.0-beta.1", "variant": "linux-x64", "speech_builds": ["linux-x64-vulkan", "linux-x64-cpu"], "files": [
        {"path": "astarot", "elf_versions": ["GLIBC_2.34", "GLIBC_2.39", "GLIBCXX_3.4.32"]},
        {"path": "_internal/libexample.so", "elf_versions": ["GLIBC_2.17"]},
        {"path": "_internal/data.json"},
    ]}
    (root / "build-manifest.json").write_text(json.dumps(manifest))
    return root


@pytest.mark.parametrize("version,expected", [("0.3.0", "0.3.0"), ("0.3.0-beta.1", "0.3.0~beta.1"),
                                              ("10.2.11-beta.12", "10.2.11~beta.12")])
def test_package_versions_sort_a_beta_before_its_release(version, expected):
    assert lp.package_version(version) == expected


@pytest.mark.parametrize("version", ["0.3", "0.3.0-rc.1", "0.3.0-beta.0", "v0.3.0", "0.3.0\n"])
def test_other_versions_are_refused(version):
    with pytest.raises(ValueError):
        lp.package_version(version)


def test_the_lowest_glibc_is_the_highest_version_any_file_needs(candidate):
    assert lp.build_facts(candidate) == ("0.3.0-beta.1", "linux-x64", "2.39")


def test_a_candidate_without_glibc_records_is_refused(candidate):
    manifest = json.loads((candidate / "build-manifest.json").read_text())
    manifest["files"] = [{"path": "astarot"}]
    (candidate / "build-manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="glibc"):
        lp.build_facts(candidate)


@pytest.mark.parametrize("change", [{"variant": "linux-x64-vulkan"}, {"variant": "linux-x64-cpu"},
                                    {"speech_builds": ["linux-x64-vulkan"]}, {"speech_builds": None}])
def test_a_candidate_without_both_engine_builds_is_refused(candidate, change):
    # Until 0.4 each engine build had a package of its own; one package now carries both.
    manifest = json.loads((candidate / "build-manifest.json").read_text())
    manifest.update(change)
    (candidate / "build-manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="both"):
        lp.build_facts(candidate)


def control_fields(control):
    return dict(line.split(": ", 1) for line in control.splitlines() if line and not line.startswith(" "))


def test_the_deb_declares_glibc_gtk_webkit_and_recommends_the_vulkan_loader():
    control = lp.deb_control("0.3.0-beta.1", "linux-x64", "2.39", 1234)
    fields = control_fields(control)
    assert fields["Package"] == "astarot"
    assert fields["Version"] == "0.3.0~beta.1"
    assert fields["Architecture"] == "amd64"
    assert fields["Installed-Size"] == "1234"
    assert fields["Depends"] == ("libc6 (>= 2.39), libwebkit2gtk-4.1-0, libgtk-3-0t64 | libgtk-3-0, "
                                  "libpipewire-0.3-0t64 | libpipewire-0.3-0")
    # The CPU build in the same package runs without Vulkan; the Vulkan build needs the loader.
    assert fields["Recommends"] == "pipewire-bin, libvulkan1, mesa-vulkan-drivers"
    assert "@" not in fields["Maintainer"]  # No personal address in published metadata.
    assert control.endswith("\n")


def test_the_package_and_the_displayed_text_name_astarot():
    # The package name, paths and files are astarot from 0.7.0 (ADR-014, 2.7); what a package
    # manager shows is the brand.
    control = lp.deb_control("0.3.0", "linux-x64", "2.39", 1)
    fields = control_fields(control)
    spec = lp.rpm_spec("0.3.0", "linux-x64", "2.39", "/staged")
    assert fields["Package"] == "astarot" and "Name: astarot" in spec.splitlines()
    assert fields["Maintainer"].startswith("ASTAROT maintainers ")
    description = spec.split("%description\n", 1)[1].split("\n%install", 1)[0]
    for text in (fields["Maintainer"], fields["Description"], control.split("Description: ", 1)[1], description):
        assert "VRCT" not in text
    assert "ASTAROT translates" in control and "ASTAROT translates" in description


def test_nothing_of_vulkan_is_required():
    fields = control_fields(lp.deb_control("0.3.0", "linux-x64", "2.39", 1))
    assert "vulkan" not in fields["Depends"]
    assert not [line for line in lp.rpm_spec("0.3.0", "linux-x64", "2.39", "/staged").splitlines()
                if line.startswith("Requires:") and "vulkan" in line]
    with pytest.raises(ValueError):
        lp.deb_control("0.3.0", "linux-x64-vulkan", "2.39", 1)


def test_the_rpm_takes_the_files_as_built_and_declares_its_requirements(tmp_path):
    spec = lp.rpm_spec("0.3.0-beta.1", "linux-x64", "2.39", tmp_path / "staged root")
    assert "Version: 0.3.0~beta.1" in spec
    assert "AutoReqProv: no" in spec  # The bundled libraries are not offered to other packages.
    assert "%global __os_install_post %{nil}" in spec  # Nothing is stripped or rewritten.
    for line in ("Requires: glibc >= 2.39", "Requires: webkit2gtk4.1", "Requires: gtk3", "Requires: pipewire-libs",
                 "Recommends: pipewire-utils", "Recommends: vulkan-loader", "Recommends: mesa-vulkan-drivers"):
        assert line in spec.splitlines()
    assert f"cp -al '{tmp_path / 'staged root'}/.'" in spec  # Hard links: no second 1 GB copy.
    files = spec.split("%files\n", 1)[1].splitlines()
    assert files[:3] == ["/opt/astarot", "/usr/bin/astarot", "/usr/bin/vrct-vox"]
    assert "/usr/share/applications/astarot.desktop" in files
    assert "%doc /usr/share/doc/astarot/NOTICE.md" in files


def test_the_new_package_replaces_the_package_up_to_0_6():
    # ADR-014, 2.7: installing the file of 0.7.0 removes vrct-vox, so the app list shows one ASTAROT.
    fields = control_fields(lp.deb_control("0.7.0-beta.1", "linux-x64", "2.39", 1))
    assert fields["Conflicts"] == fields["Replaces"] == fields["Provides"] == "vrct-vox"
    spec = lp.rpm_spec("0.7.0-beta.1", "linux-x64", "2.39", "/staged").splitlines()
    # Versioned, so that the package does not obsolete itself through what it provides.
    assert "Obsoletes: vrct-vox < 0.7.0~beta.1-1" in spec
    assert "Provides: vrct-vox = 0.7.0~beta.1-1" in spec


@pytest.mark.parametrize("version,kept", [("0.7.0-beta.1", True), ("0.7.9", True), ("0.8.0-beta.1", False),
                                          ("0.8.0", False), ("1.0.0", False)])
def test_the_command_up_to_0_6_stays_until_its_period_ends(version, kept):
    # ADR-014, 8.2: /usr/bin/vrct-vox while LEGACY_COMMAND_UNTIL says; its prerelease goes with 0.8.0.
    assert lp.LEGACY_COMMAND_UNTIL == (0, 8, 0)
    assert lp.commands(version) == (["astarot", "vrct-vox"] if kept else ["astarot"])
    files = lp.rpm_spec(version, "linux-x64", "2.39", "/staged").split("%files\n", 1)[1].splitlines()
    assert ("/usr/bin/vrct-vox" in files) is kept


@pytest.mark.parametrize("kind", ["deb", "rpm"])
def test_the_installed_tree_has_the_app_under_opt_and_the_desktop_files_under_usr(candidate, tmp_path, kind):
    root = lp.stage(candidate, tmp_path / "root", kind)
    app = root / "opt/astarot"
    assert (app / "astarot").read_bytes() == b"\x7fELF main"
    assert (app / "_internal/libexample.so").is_file()
    assert (app / "package-manager").read_text() == kind + "\n"
    # The desktop entry's command, and the command up to 0.6.x while it stays: both start the
    # executable (ADR-014, 2.5 to 2.7).
    for command in ("astarot", "vrct-vox"):
        assert (root / "usr/bin" / command).read_text() == '#!/bin/sh\nexec /opt/astarot/astarot "$@"\n'
    desktop = (root / "usr/share/applications/astarot.desktop").read_text().splitlines()
    assert "Exec=astarot" in desktop and "StartupWMClass=astarot" in desktop and "Icon=astarot" in desktop
    assert (root / "usr/share/icons/hicolor/256x256/apps/astarot.png").read_bytes()[:4] == b"\x89PNG"
    assert (root / "usr/share/doc/astarot/copyright").read_text().startswith("MIT License")
    assert (root / "usr/share/doc/astarot/NOTICE.md").is_file()
    # Nothing the package adds under /usr has the name up to 0.6.x but the command.
    old = [path.relative_to(root).as_posix() for path in (root / "usr").rglob("*vrct-vox*")]
    assert old == ["usr/bin/vrct-vox"]


def test_a_folder_that_is_not_a_candidate_is_refused(tmp_path):
    (tmp_path / "empty").mkdir()
    with pytest.raises(ValueError, match="candidate"):
        lp.stage(tmp_path / "empty", tmp_path / "root", "deb")

def test_the_stand_in_of_the_package_up_to_0_6_has_its_name_and_paths(tmp_path):
    # tools/ci/legacy_linux_packages.py: what tools/ci/check_linux_package.sh installs first.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/ci"))
    import legacy_linux_packages as legacy

    fields = control_fields(legacy.deb_control())
    assert fields["Package"] == "vrct-vox" and fields["Architecture"] == "amd64"
    # Below every package of 0.7.0, its prereleases included.
    assert legacy.VERSION == "0.6.99" and lp.package_version("0.7.0-beta.1") > legacy.VERSION
    for kind in ("deb", "rpm"):
        root = legacy.stage(tmp_path / kind, kind)
        assert (root / "opt/vrct-vox/package-manager").read_text() == kind + "\n"
        assert (root / "usr/bin/vrct-vox").read_text() == '#!/bin/sh\nexec /opt/vrct-vox/vrct-vox "$@"\n'
        assert "Icon=vrct-vox" in (root / "usr/share/applications/vrct-vox.desktop").read_text().splitlines()
    spec = legacy.rpm_spec(tmp_path / "rpm")
    assert "Name: vrct-vox" in spec.splitlines() and "Version: 0.6.99" in spec.splitlines()
    files = spec.split("%files\n", 1)[1].splitlines()
    # The folder as a whole, as up to 0.6.x: removing the package removes it.
    assert files[0] == "/opt/vrct-vox" and "/usr/bin/vrct-vox" in files


def test_stand_in_version_is_older_than_the_candidate(tmp_path):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/ci"))
    import legacy_linux_packages as legacy

    for candidate, expected in (("0.6.0", "0.5.99"), ("0.7.0-beta.1", "0.6.99")):
        version = legacy.stand_in_version(candidate)
        assert version == expected
        assert control_fields(legacy.deb_control(version))["Version"] == expected
        assert f"Version: {expected}" in legacy.rpm_spec(tmp_path, version).splitlines()

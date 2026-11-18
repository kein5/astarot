"""release.yml builds the Windows installer after the package, with its hash built in."""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _workflow():
    return yaml.load((ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_the_installer_is_built_after_the_package_and_checked_against_it():
    jobs = _workflow()["jobs"]
    assert jobs["candidate"]["needs"] == "build"
    # The required check on main keeps its name.
    assert jobs["candidate"]["name"] == "Windows candidate (not a release)"
    steps = jobs["build"]["steps"]
    bundle = next(step for step in steps if "installer_package_hashes.py write" in step.get("run", ""))
    assert bundle["env"]["VRCT_REQUIRE_PACKAGE_HASHES"] == "1"
    assert bundle["run"].index("installer_package_hashes.py write") < bundle["run"].index("bundle --bundles nsis")
    assert "installer_package_hashes.py write --package VRCT-VOX.zip" in bundle["run"]
    # In pwsh, "npm run tauri -- …" loses the "--" (npm.ps1), so npm eats --bundles: call the CLI directly.
    assert bundle["shell"] == "pwsh" and "npm run tauri" not in bundle["run"]
    assert "node node_modules/@tauri-apps/cli/tauri.js bundle --bundles nsis" in bundle["run"]
    names = [step.get("name", "") for step in steps]
    assert names.index("Build and inspect VRCT-VOX.zip") < names.index(bundle["name"])
    candidate = "\n".join(step.get("run", "") for step in jobs["candidate"]["steps"])
    assert "installer_package_hashes.py check" in candidate
    assert candidate.index("installer_package_hashes.py check") < candidate.index("release_candidate.py stage")


def test_there_is_one_windows_package_and_no_cuda_package():
    # Up to 0.5 a build-cuda job made VRCT-VOX_cuda.zip; it held the same files from 0.5.0 (#288).
    workflow = _workflow()
    text = json.dumps(workflow)  # Without the comments, which tell the history.
    jobs = workflow["jobs"]
    assert set(jobs) == {"changelog", "build", "candidate"}
    assert "_cuda.zip" not in text and "release-cuda" not in text and "--gpu" not in text
    scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "release-cuda" not in scripts and "release-all" not in scripts


def test_the_package_job_uses_the_shared_steps():
    action = yaml.load((ROOT / ".github/actions/windows-package/action.yml").read_text(encoding="utf-8"),
                       Loader=yaml.BaseLoader)
    uses = [step for step in _workflow()["jobs"]["build"]["steps"] if step.get("uses") == "./.github/actions/windows-package"]
    assert len(uses) == 1 and uses[0]["with"] == {"script": "release", "package": "VRCT-VOX.zip"}
    assert set(action["inputs"]) == {"script", "package"}
    for step in action["runs"]["steps"]:
        if "uses" in step:
            assert "@" in step["uses"] and len(step["uses"].split("@", 1)[1].split()[0]) == 40, step["uses"]
        assert "${{" not in step.get("run", ""), step.get("name")

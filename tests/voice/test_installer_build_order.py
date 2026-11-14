"""release.yml builds the Windows installer after both packages, with their hashes built in."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def test_the_installer_is_built_after_both_packages_and_checked_against_them():
    workflow = yaml.load((ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    jobs = workflow["jobs"]
    assert jobs["build-cpu"]["needs"] == "build-cuda"
    assert jobs["candidate"]["needs"] == ["build-cuda", "build-cpu"]
    # The required check on main keeps its name.
    assert jobs["candidate"]["name"] == "Windows candidate (not a release)"
    steps = jobs["build-cpu"]["steps"]
    bundle = next(step for step in steps if "installer_package_hashes.py write" in step.get("run", ""))
    assert bundle["env"]["VRCT_REQUIRE_PACKAGE_HASHES"] == "1"
    assert bundle["run"].index("installer_package_hashes.py write") < bundle["run"].index("bundle --bundles nsis")
    names = [step.get("name", "") for step in steps]
    assert names.index("Build and inspect VRCT-VOX.zip") < names.index(bundle["name"])
    received = next(step for step in steps if step.get("with", {}).get("name") == "windows-cuda-hash")
    assert steps.index(received) < steps.index(bundle)
    candidate = "\n".join(step.get("run", "") for step in jobs["candidate"]["steps"])
    assert "installer_package_hashes.py check" in candidate
    assert candidate.index("installer_package_hashes.py check") < candidate.index("release_candidate.py stage")


def test_both_package_jobs_build_with_the_same_steps():
    action = yaml.load((ROOT / ".github/actions/windows-package/action.yml").read_text(encoding="utf-8"),
                       Loader=yaml.BaseLoader)
    workflow = yaml.load((ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    for job, variant in (("build-cuda", "cuda"), ("build-cpu", "cpu")):
        uses = [step for step in workflow["jobs"][job]["steps"] if step.get("uses") == "./.github/actions/windows-package"]
        assert len(uses) == 1 and uses[0]["with"]["variant"] == variant, job
    for step in action["runs"]["steps"]:
        if "uses" in step:
            assert "@" in step["uses"] and len(step["uses"].split("@", 1)[1].split()[0]) == 40, step["uses"]
        assert "${{" not in step.get("run", ""), step.get("name")

// Checks how the guide's download button (site/theme/lib/releases.mjs) reads release
// assets: the files of v0.2.0 as published, the deb and rpm that 0.3.0 adds, layouts a later
// release may take, and files that are not downloads.
//
//   node tools/check_site_downloads.mjs          # the lists below
//   node tools/check_site_downloads.mjs --live   # also the latest release, from the GitHub API
//
// Exits 1 and names the release and the file when a rule reads one wrongly.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const { classify, detectPlatform, readRelease, recommend, LATEST_API, REPO_URL } = await import(
    pathToFileURL(resolve(root, "site/theme/lib/releases.mjs"))
);

const asset = (tag, name, size = 1) => ({
    name,
    size,
    browser_download_url: `${REPO_URL}/releases/download/${tag}/${encodeURIComponent(name)}`,
});
const release = (tag, names) => ({
    tag_name: tag,
    html_url: `${REPO_URL}/releases/tag/${tag}`,
    assets: names.map((name) => asset(tag, name)),
});
const withSums = (names) => names.flatMap((name) => [name, `${name}.sha256`]);

// What each release should list, as "os format variant arch" per file, and what the button
// offers on Windows and on Linux.
const CASES = [
    {
        title: "v0.2.0 as published",
        release: release("v0.2.0", [
            "candidate-linux.json",
            "candidate-windows.json",
            "SHA256SUMS-linux",
            "SHA256SUMS-windows",
            ...withSums([
                "VRCT-VOX-0.2.0-linux-x64-vulkan-release.AppImage",
                "VRCT-VOX-0.2.0-linux-x64-vulkan-release.tar.gz",
                "VRCT-VOX.zip",
                "VRCT-VOX_cuda.zip",
                "VRCT-VOX_setup.exe",
            ]),
        ]),
        expect: {
            "VRCT-VOX_setup.exe": "windows installer - -",
            "VRCT-VOX.zip": "windows zip cpu -",
            "VRCT-VOX_cuda.zip": "windows zip cuda -",
            "VRCT-VOX-0.2.0-linux-x64-vulkan-release.AppImage": "linux appimage vulkan x64",
            "VRCT-VOX-0.2.0-linux-x64-vulkan-release.tar.gz": "linux tar vulkan x64",
        },
        windows: "VRCT-VOX_setup.exe",
        linux: "VRCT-VOX-0.2.0-linux-x64-vulkan-release.AppImage",
        skipped: 0,
    },
    {
        title: "0.3.0 with deb and rpm",
        release: release("v0.3.0", [
            "candidate-linux.json",
            "candidate-windows.json",
            "SHA256SUMS-linux",
            "SHA256SUMS-windows",
            ...withSums([
                "VRCT-VOX-0.3.0-linux-x64-vulkan-release.AppImage",
                "VRCT-VOX-0.3.0-linux-x64-vulkan-release.tar.gz",
                "VRCT-VOX-0.3.0-linux-x64-vulkan-release.deb",
                "VRCT-VOX-0.3.0-linux-x64-vulkan-release.rpm",
                "VRCT-VOX.zip",
                "VRCT-VOX_cuda.zip",
                "VRCT-VOX_setup.exe",
            ]),
        ]),
        expect: {
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.deb": "linux deb vulkan x64",
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.rpm": "linux rpm vulkan x64",
        },
        order: [
            "VRCT-VOX_setup.exe",
            "VRCT-VOX.zip",
            "VRCT-VOX_cuda.zip",
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.AppImage",
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.deb",
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.rpm",
            "VRCT-VOX-0.3.0-linux-x64-vulkan-release.tar.gz",
        ],
        windows: "VRCT-VOX_setup.exe",
        linux: "VRCT-VOX-0.3.0-linux-x64-vulkan-release.AppImage",
        skipped: 0,
    },
    {
        // One Windows build once CPU and CUDA are one (#288), and a CPU-only Linux build.
        title: "one Windows build, CPU Linux build",
        release: release(
            "v0.4.0",
            withSums([
                "VRCT-VOX.zip",
                "VRCT-VOX_setup.exe",
                "VRCT-VOX-0.4.0-linux-x64-cpu-release.AppImage",
                "VRCT-VOX-0.4.0-linux-x64-cpu-release.deb",
            ]),
        ),
        expect: { "VRCT-VOX.zip": "windows zip - -", "VRCT-VOX-0.4.0-linux-x64-cpu-release.deb": "linux deb cpu x64" },
        windows: "VRCT-VOX_setup.exe",
        linux: "VRCT-VOX-0.4.0-linux-x64-cpu-release.AppImage",
        skipped: 0,
    },
    {
        // Tauri's own bundle names, an arm64 build, a macOS disk image and files that are not
        // downloads at all.
        title: "Tauri bundle names and unknown files",
        release: release("v0.5.0", [
            "VRCT-VOX_0.5.0_x64-setup.exe",
            "VRCT-VOX_0.5.0_x64_en-US.msi",
            "VRCT-VOX_0.5.0_x64_en-US.msi.sig",
            "vrct-vox_0.5.0_amd64.deb",
            "vrct-vox-0.5.0-1.x86_64.rpm",
            "VRCT-VOX_0.5.0_amd64.AppImage",
            "VRCT-VOX_0.5.0_aarch64.AppImage",
            "VRCT-VOX_0.5.0_aarch64.dmg",
            "latest.json",
            "VRCT-VOX-0.5.0-source.tar.gz",
            "VRCT-VOX-0.5.0.7z",
            "VRCT-VOX-0.5.0.flatpak",
        ]),
        expect: {
            "VRCT-VOX_0.5.0_x64-setup.exe": "windows installer - x64",
            "VRCT-VOX_0.5.0_x64_en-US.msi": "windows msi - x64",
            "vrct-vox_0.5.0_amd64.deb": "linux deb - x64",
            "vrct-vox-0.5.0-1.x86_64.rpm": "linux rpm - x64",
            "VRCT-VOX_0.5.0_amd64.AppImage": "linux appimage - x64",
            "VRCT-VOX_0.5.0_aarch64.AppImage": "linux appimage - arm64",
            "VRCT-VOX_0.5.0_aarch64.dmg": "macos dmg - arm64",
            "VRCT-VOX-0.5.0-source.tar.gz": null,
            "VRCT-VOX-0.5.0.7z": null,
            "VRCT-VOX-0.5.0.flatpak": null,
            "latest.json": null,
        },
        windows: "VRCT-VOX_0.5.0_x64-setup.exe",
        linux: "VRCT-VOX_0.5.0_amd64.AppImage",
        linuxArm: "VRCT-VOX_0.5.0_aarch64.AppImage",
        // The x64 files only; the source archive is not the Linux tar.gz.
        skipped: 3,
    },
    {
        // ADR-014, 2.10: the files are named ASTAROT from 0.7.0, and 0.7.x carries each one again
        // under its name up to 0.6.x for older links. A copy is not listed twice.
        title: "0.7.0 named ASTAROT, with copies under the names up to 0.6.x",
        release: release("v0.7.0", [
            "candidate-linux.json",
            "candidate-windows.json",
            "SHA256SUMS-linux",
            "SHA256SUMS-windows",
            "latest.json",
            ...withSums([
                "ASTAROT-0.7.0-linux-x64-release.AppImage",
                "ASTAROT-0.7.0-linux-x64-release.tar.gz",
                "ASTAROT-0.7.0-linux-x64-release.deb",
                "ASTAROT-0.7.0-linux-x64-release.rpm",
                "ASTAROT.zip",
                "ASTAROT_setup.exe",
                "VRCT-VOX-0.7.0-linux-x64-release.AppImage",
                "VRCT-VOX-0.7.0-linux-x64-release.tar.gz",
                "VRCT-VOX-0.7.0-linux-x64-release.deb",
                "VRCT-VOX-0.7.0-linux-x64-release.rpm",
                "VRCT-VOX.zip",
                "VRCT-VOX_setup.exe",
            ]),
        ]),
        expect: {
            "ASTAROT_setup.exe": "windows installer - -",
            "ASTAROT.zip": "windows zip - -",
            "ASTAROT-0.7.0-linux-x64-release.AppImage": "linux appimage - x64",
            "ASTAROT-0.7.0-linux-x64-release.deb": "linux deb - x64",
            "VRCT-VOX_setup.exe": null,
            "VRCT-VOX.zip": null,
            "VRCT-VOX-0.7.0-linux-x64-release.AppImage": null,
            "VRCT-VOX-0.7.0-linux-x64-release.deb": null,
        },
        order: [
            "ASTAROT_setup.exe",
            "ASTAROT.zip",
            "ASTAROT-0.7.0-linux-x64-release.AppImage",
            "ASTAROT-0.7.0-linux-x64-release.deb",
            "ASTAROT-0.7.0-linux-x64-release.rpm",
            "ASTAROT-0.7.0-linux-x64-release.tar.gz",
        ],
        windows: "ASTAROT_setup.exe",
        linux: "ASTAROT-0.7.0-linux-x64-release.AppImage",
        skipped: 0,
    },
    {
        // A file named VRCT-VOX without its ASTAROT counterpart is a file of its own.
        title: "a VRCT-VOX file alone is listed",
        release: release("v0.7.1", withSums(["ASTAROT_setup.exe", "VRCT-VOX.zip"])),
        expect: { "ASTAROT_setup.exe": "windows installer - -", "VRCT-VOX.zip": "windows zip - -" },
        windows: "ASTAROT_setup.exe",
        skipped: 0,
    },
    {
        title: "a release without files",
        release: release("v9.9.9", []),
        expect: {},
        windows: null,
        linux: null,
        skipped: 0,
    },
];

const failures = [];
const fail = (title, message) => failures.push(`${title}: ${message}`);
const describe = (item) => (item ? [item.os, item.format, item.variant ?? "-", item.arch ?? "-"].join(" ") : null);

for (const test of CASES) {
    const read = readRelease(test.release);
    const byName = new Map(read.downloads.map((item) => [item.name, item]));
    for (const [name, want] of Object.entries(test.expect)) {
        const got = describe(byName.get(name));
        if (got !== want) fail(test.title, `${name} reads as ${got ?? "not listed"}, expected ${want ?? "not listed"}`);
    }
    if (test.order) {
        const got = read.downloads.map((item) => item.name);
        if (got.join("\n") !== test.order.join("\n")) fail(test.title, `order is\n  ${got.join("\n  ")}`);
    }
    for (const [os, arch, key] of [
        ["windows", "x64", "windows"],
        ["linux", "x64", "linux"],
        ["linux", "arm64", "linuxArm"],
    ]) {
        if (!(key in test)) continue;
        const got = recommend(read.downloads, os, arch)?.name ?? null;
        if (got !== test[key]) fail(test.title, `${os} ${arch} is offered ${got}, expected ${test[key]}`);
    }
    if (recommend(read.downloads, "macos") && !read.downloads.some((item) => item.os === "macos"))
        fail(test.title, "macOS is offered a file");
    if (read.skipped !== test.skipped) fail(test.title, `${read.skipped} files left out, expected ${test.skipped}`);
    if (read.tag !== test.release.tag_name) fail(test.title, `version reads as ${read.tag}`);
}

// Files outside this repository's releases never become links.
if (classify({ name: "VRCT-VOX_setup.exe", browser_download_url: "https://example.com/VRCT-VOX_setup.exe" })) {
    failures.push("a file outside the repository's releases is listed");
}
if (readRelease(null).downloads.length !== 0 || readRelease({ assets: "x" }).downloads.length !== 0) {
    failures.push("a broken API answer is not read as an empty release");
}

const PLATFORMS = [
    [
        { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" },
        "windows x64",
    ],
    [{ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0" }, "linux x64"],
    [{ userAgent: "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" }, "linux arm64"],
    [
        {
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15",
        },
        "macos x64",
    ],
    [
        { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36" },
        "other x64",
    ],
    [
        { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" },
        "other x64",
    ],
    [
        { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" },
        "other x64",
    ],
    [{ userAgent: "Mozilla/5.0", userAgentData: { platform: "Windows", mobile: false } }, "windows x64"],
];
for (const [nav, want] of PLATFORMS) {
    const { os, arch } = detectPlatform(nav);
    if (`${os} ${arch}` !== want) failures.push(`${nav.userAgent} reads as ${os} ${arch}, expected ${want}`);
}

if (process.argv.includes("--live")) {
    const response = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) {
        failures.push(`latest release: the API answered ${response.status}`);
    } else {
        const read = readRelease(await response.json());
        console.log(`latest release ${read.tag}:`);
        for (const item of read.downloads) console.log(`  ${describe(item).padEnd(30)} ${item.name}`);
        console.log(`  left out: ${read.skipped}`);
        for (const os of ["windows", "linux"]) {
            const offered = recommend(read.downloads, os);
            console.log(`  ${os} button: ${offered?.name ?? "none"}`);
            if (!offered) failures.push(`latest release ${read.tag}: nothing to offer on ${os}`);
        }
    }
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(`download rules: ${CASES.length} releases, ${PLATFORMS.length} browsers read as expected`);

# Install

Downloads are on [GitHub Releases](https://github.com/kein5/astarot/releases). The stable release is marked "Latest"; betas are published as pre-releases. Supported operating systems and the memory, GPU and disk space each feature needs are in [System requirements](requirements).

Windows comes first below; Linux is in [its own section](#linux).

## Windows

1. On [GitHub Releases](https://github.com/kein5/astarot/releases), open the release marked "Latest" and download `VRCT-VOX_setup.exe` from its "Assets".
2. Open the file you downloaded. If SmartScreen warns you, continue as the note below says.
3. On the way, it asks for the CPU or the GPU version. Since 0.5.0 both hold the same files, so either choice works the same.
4. When it is installed, start ASTAROT and go on to [First setup](./first-setup).

::: warning SmartScreen warns on first launch
The Windows build is not code-signed. When "Windows protected your PC" appears, press "More info" and then "Run anyway".
:::

Since 0.5.0 the CPU version and the GPU (CUDA) version hold the same files. The GPU version used to be the one that ran local translation on an NVIDIA GPU; now local translation runs on the CPU in both. Speech and realtime captions (speech.cpp, which comes with the app) can use a GPU in either version.

For VRChat to hear your speech, you also need a virtual cable ([Windows audio route](./windows-audio)).

### Run it without installing (ZIP)

To run from an unpacked folder without installing, use a ZIP.

- `VRCT-VOX.zip` (CPU)
- `VRCT-VOX_cuda.zip` (CUDA; since 0.5.0 the same files as `VRCT-VOX.zip`)

::: details Where settings and data are stored (Windows)
The settings (`config.json`), logs and downloaded models are inside the folder the app is in.

| Installed with | Location |
|---|---|
| Installer | <CopyText>%LOCALAPPDATA%\VRCT-VOX</CopyText> (unless you changed the folder) |
| ZIP | The folder you unpacked it to |
:::

## Linux

There is an x64 <Term tip="A way for apps to draw and compute on the GPU. NVIDIA, AMD and Intel GPU drivers support it.">Vulkan</Term> build in four formats: deb, rpm, AppImage and tar.gz (deb and rpm from 0.3.0). To check that a download is intact, see [Check your download](#check-your-download).

### deb (Ubuntu, Debian)

```sh
sudo apt install ./VRCT-VOX-<version>-linux-x64-vulkan-release.deb
```

The app goes to `/opt/vrct-vox` and shows up in your app list as VRCT-VOX. From a terminal, run `vrct-vox`. Install a new version with the same command. To remove it, run `sudo apt remove vrct-vox`.

### rpm (Fedora)

```sh
sudo dnf install ./VRCT-VOX-<version>-linux-x64-vulkan-release.rpm
```

It installs to the same place and starts the same way as the deb. To remove it, run `sudo dnf remove vrct-vox`.

The deb and rpm are tested on Ubuntu 24.04, Debian 13 and Fedora 44: they install, and the libraries they need are all there. The PipeWire tools and Vulkan drivers come in as recommended packages.

### AppImage

```sh
chmod +x VRCT-VOX-<version>-linux-x64-vulkan-release.AppImage
./VRCT-VOX-<version>-linux-x64-vulkan-release.AppImage
```

Without <Term tip="Lets a Linux app provide a file system without changing the kernel. An AppImage uses it to start.">FUSE</Term>, start it with <CopyText>APPIMAGE_EXTRACT_AND_RUN=1</CopyText>. This needs extra free disk space while the app is unpacked (about 1.7 GB for the version we tested).

### tar.gz

```sh
tar -xzf VRCT-VOX-<version>-linux-x64-vulkan-release.tar.gz
./VRCT-VOX/vrct-vox
```

Keep the contents of the unpacked `VRCT-VOX` folder together, as they are. WebKitGTK 4.1, GTK 3, PipeWire, Vulkan and similar libraries come from your system. It is not promised to work on every distribution.

::: details Where settings and data are stored (Linux)
| Content | Location |
|---|---|
| Settings and logs | <CopyText>~/.config/vrct-vox</CopyText> (under `$XDG_CONFIG_HOME` if set) |
| Data | <CopyText>~/.local/share/vrct-vox</CopyText> |
| Cache | <CopyText>~/.cache/vrct-vox</CopyText> |

The deb, rpm, AppImage and tar.gz all use the same locations.
:::

## Check your download

Every file has a `.sha256`, and `SHA256SUMS-*` lists them all. These check that a file is intact; they are not signatures.

The Windows installer checks the ZIP it downloads by itself. From 0.3.0 it carries the SHA-256 of the ZIPs released with it, so it does not unpack a different ZIP even if files on the release page were replaced.

On Linux, put `SHA256SUMS-linux` in the folder with your download and run:

```sh
sha256sum -c --ignore-missing SHA256SUMS-linux
```

::: details Check the build provenance (from 0.3.0)
Every file also has build provenance: a record, signed by GitHub, of which workflow in this repository built the file and from which commit. Provenance can only be made inside this repository's workflows, so the right to replace release files is not enough to make it.

To check a file, install the [GitHub CLI](https://cli.github.com/) and run this in the folder you downloaded to, with the name of the file you want to check:

```sh
gh attestation verify VRCT-VOX_setup.exe --owner kein5 --signer-repo kein5/VRCT-VOX
```

Files up to 0.5.0 were built before the repository was renamed to `kein5/astarot`, so their provenance names the old `kein5/VRCT-VOX`. That is why the command names the owner (`kein5`) and the old name. For files after 0.5.0, run `gh attestation verify <file> --repo kein5/astarot`.

If it prints "Verification succeeded!", the file was built by this repository's workflow. If it fails, don't use the file, and tell us in an Issue.
:::

## Updates

When a new version is out, the top bar says so. You can also check in Settings → Update. How you update depends on how you installed ASTAROT.

| Installed with | How to update |
|---|---|
| The Windows installer | Press "Update to (version) and restart" in Update. The update is installed only after its signature is checked, and ASTAROT restarts when it is done |
| The AppImage | The same button replaces the AppImage file with the new one |
| The Windows ZIP or the Linux tar.gz | The app only tells you a new version is out. Install it again from GitHub Releases |
| deb or rpm | The app does not check. Update with your package manager |

"Check for updates at start" in Update turns the check at start off. A failed check does not stop the app. Your settings and downloaded models stay in the locations above.

The Windows installer unpacks and checks the new version before it replaces the old one. If something fails on the way, it puts the old version back. Your settings, models and logs are kept.

::: warning If you use a ZIP
Your settings and models are inside the unpacked folder, so unpacking a new ZIP to another folder starts without them. Use the installer if you want them carried over on every update.
:::

## One running copy

If you start ASTAROT while it is already running, it brings the running window to the front instead of starting again.

Next, see [First setup](./first-setup).

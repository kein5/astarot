//! Putting text on the system clipboard, with the tools the Python implementation used.

use std::io::Write;
use std::process::{Command, Stdio};

/// The clipboard tool of this desktop, chosen once like pyperclip's
/// `determine_clipboard`: `wl-copy` on Wayland (with `wl-paste` present), else with an
/// X11 display `xclip`, `xsel`, then Klipper over `qdbus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    WlCopy,
    Xclip,
    Xsel,
    Klipper,
    Pbcopy,
}

pub fn executable_exists(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&path).any(|dir| {
        let candidate = dir.join(name);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            candidate.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        }
        #[cfg(not(unix))]
        {
            candidate.is_file() || candidate.with_extension("exe").is_file()
        }
    })
}

/// The tool for an environment (`WAYLAND_DISPLAY`, `DISPLAY`) and the executables found.
pub fn choose_tool(wayland: bool, display: bool, exists: impl Fn(&str) -> bool) -> Option<Tool> {
    if cfg!(target_os = "macos") {
        return Some(Tool::Pbcopy);
    }
    if wayland && exists("wl-copy") && exists("wl-paste") {
        return Some(Tool::WlCopy);
    }
    if display {
        if exists("xclip") {
            return Some(Tool::Xclip);
        }
        if exists("xsel") {
            return Some(Tool::Xsel);
        }
        if exists("klipper") && exists("qdbus") {
            return Some(Tool::Klipper);
        }
    }
    None
}

#[cfg(not(windows))]
fn system_tool() -> Option<Tool> {
    static TOOL: std::sync::OnceLock<Option<Tool>> = std::sync::OnceLock::new();
    *TOOL.get_or_init(|| {
        let set = |name| std::env::var_os(name).is_some_and(|v| !v.is_empty());
        choose_tool(set("WAYLAND_DISPLAY"), set("DISPLAY"), executable_exists)
    })
}

fn feed(mut command: Command, input: &[u8]) -> bool {
    astarot_app_identity::appimage::restore_host_environment(&mut command);
    command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut child) = command.spawn() else { return false };
    let written = child.stdin.take().is_some_and(|mut stdin| stdin.write_all(input).is_ok());
    // Like pyperclip, the tool's exit status is not checked once it read the text.
    child.wait().is_ok() && written
}

/// Copy `text` with `tool`.
pub fn copy_with(tool: Tool, text: &str) -> bool {
    match tool {
        Tool::WlCopy if text.is_empty() => astarot_app_identity::appimage::restore_host_environment(&mut Command::new("wl-copy"))
            .arg("--clear")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success()),
        Tool::WlCopy => feed(Command::new("wl-copy"), text.as_bytes()),
        Tool::Xclip => {
            let mut command = Command::new("xclip");
            command.args(["-selection", "c"]);
            feed(command, text.as_bytes())
        }
        Tool::Xsel => {
            let mut command = Command::new("xsel");
            command.args(["-b", "-i"]);
            feed(command, text.as_bytes())
        }
        Tool::Klipper => {
            let mut command = Command::new("qdbus");
            command.args(["org.kde.klipper", "/klipper", "setClipboardContents", text]);
            feed(command, b"")
        }
        Tool::Pbcopy => {
            let mut command = Command::new("pbcopy");
            command.arg("w");
            feed(command, text.as_bytes())
        }
    }
}

/// `clip.exe` with UTF-16LE and a BOM, so Windows reads the text as Unicode.
pub fn copy_with_clip_exe(text: &str) -> bool {
    let mut input = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        input.extend_from_slice(&unit.to_le_bytes());
    }
    feed(Command::new("clip"), &input)
}

/// Copy `text` to the system clipboard. False when no way to copy worked.
pub fn copy_to_clipboard(text: &str) -> bool {
    #[cfg(windows)]
    {
        copy_with_clip_exe(text) || super::windows::copy_with_api(text)
    }
    #[cfg(not(windows))]
    {
        system_tool().is_some_and(|tool| copy_with(tool, text))
    }
}

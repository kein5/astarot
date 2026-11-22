//! The X11 capture against a real X server (X11 or XWayland). It shows a small window
//! of its own for about a second, so it only runs when asked:
//!
//! ```sh
//! cargo test --test capture_live -- --ignored --nocapture
//! ```

#![cfg(target_os = "linux")]

use astarot_ocr_runtime::capture::x11::X11WindowCapture;
use astarot_ocr_runtime::capture::WindowCapture;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ChangeGCAux, ConnectionExt, CreateGCAux, CreateWindowAux, EventMask, PropMode, Rectangle, WindowClass};
use x11rb::wrapper::ConnectionExt as _;

#[test]
#[ignore = "opens a window on the desktop; run with --ignored"]
fn reads_a_window_found_by_title() {
    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        eprintln!("SKIPPED: no X display");
        return;
    };
    let screen = &conn.setup().roots[screen_num];
    let (width, height) = (160u16, 90u16);
    let window = conn.generate_id().unwrap();
    // Override-redirect: shown without asking the window manager (KWin on Wayland left a
    // bare test window unmapped). VRChat's own window is a normal managed one.
    conn.create_window(
        screen.root_depth,
        window,
        screen.root,
        40,
        40,
        width,
        height,
        0,
        WindowClass::INPUT_OUTPUT,
        screen.root_visual,
        &CreateWindowAux::new().background_pixel(0x0010_2030).override_redirect(1).event_mask(EventMask::EXPOSURE | EventMask::STRUCTURE_NOTIFY),
    )
    .unwrap();
    let title = format!("ocr-runtime live test {}", std::process::id());
    conn.change_property8(PropMode::REPLACE, window, AtomEnum::WM_NAME, AtomEnum::STRING, title.as_bytes()).unwrap();
    let net_wm_name = conn.intern_atom(false, b"_NET_WM_NAME").unwrap().reply().unwrap().atom;
    let utf8 = conn.intern_atom(false, b"UTF8_STRING").unwrap().reply().unwrap().atom;
    conn.change_property8(PropMode::REPLACE, window, net_wm_name, utf8, title.as_bytes()).unwrap();
    conn.map_window(window).unwrap();
    conn.flush().unwrap();

    // Paint once the window is shown: left half 0x102030, right half 0xC0A080.
    let gc = conn.generate_id().unwrap();
    conn.create_gc(gc, window, &CreateGCAux::new().foreground(0x00C0_A080)).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut capture = X11WindowCapture::new(&title);
    let mut frame = None;
    while std::time::Instant::now() < deadline {
        conn.clear_area(false, window, 0, 0, width, height).unwrap();
        conn.change_gc(gc, &ChangeGCAux::new().foreground(0x00C0_A080)).unwrap();
        conn.poly_fill_rectangle(window, gc, &[Rectangle { x: (width / 2) as i16, y: 0, width: width / 2, height }]).unwrap();
        conn.sync().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let result = capture.capture();
        if let Ok(Some(found)) = result {
            if found.pixel(width as usize - 10, 10) == [0x80, 0xA0, 0xC0] {
                frame = Some(found);
                break;
            }
        }
    }
    let found_by_title = capture.find().unwrap();
    conn.destroy_window(window).unwrap();
    conn.flush().unwrap();
    let frame = frame.expect("the window was not captured with its painted pixels");
    assert_eq!((frame.width, frame.height), (width as usize, height as usize));
    assert_eq!(frame.pixel(10, 10), [0x30, 0x20, 0x10]); // BGR of 0x102030
    assert_eq!(frame.pixel(width as usize - 10, height as usize - 10), [0x80, 0xA0, 0xC0]);
    assert!(found_by_title);
    println!("METRIC x11 live: found the window by title and read {}x{} BGR pixels", frame.width, frame.height);
}

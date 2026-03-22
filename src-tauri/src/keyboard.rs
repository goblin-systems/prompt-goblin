use crate::debug_log::{write_debug_log_message, DebugLogState};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, State};

const NEWLINE_KEY_DELAY_MS: u64 = 30;

#[derive(Debug, PartialEq, Eq)]
enum TypingAction {
    Text(String),
    Newline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LineBreakMode {
    Enter,
    ShiftEnter,
    CtrlEnter,
}

impl LineBreakMode {
    fn from_str(value: &str) -> Self {
        match value {
            "shift_enter" => Self::ShiftEnter,
            "ctrl_enter" => Self::CtrlEnter,
            _ => Self::Enter,
        }
    }
}

fn escape_for_log(text: &str) -> String {
    text.replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn log_key_event(app: &AppHandle, state: &DebugLogState, text: &str, command: &str) {
    let escaped = escape_for_log(text);
    let message = format!(
        "Keyboard {} length={} text=\"{}\"",
        command,
        text.chars().count(),
        escaped
    );
    let _ = write_debug_log_message(app, state, "INFO", &message);
}

fn build_typing_actions(text: &str) -> Vec<TypingAction> {
    let mut actions = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        if c == '\r' {
            continue;
        }

        if c == '\n' {
            if !current.is_empty() {
                actions.push(TypingAction::Text(std::mem::take(&mut current)));
            }
            actions.push(TypingAction::Newline);
        } else {
            current.push(c);
        }
    }

    if !current.is_empty() {
        actions.push(TypingAction::Text(current));
    }

    actions
}

/// Type the full text at once into the currently focused window.
#[tauri::command]
pub fn type_text(
    app: AppHandle,
    state: State<DebugLogState>,
    text: String,
    line_break_mode: Option<String>,
) -> Result<(), String> {
    log_key_event(&app, &state, &text, "type_text");
    send_text_native(
        &text,
        LineBreakMode::from_str(line_break_mode.as_deref().unwrap_or("enter")),
    )
}

/// Type a chunk of text incrementally (for beta incremental mode).
/// Optionally send backspaces first to erase previous partial text.
#[tauri::command]
pub fn type_text_incremental(
    app: AppHandle,
    state: State<DebugLogState>,
    text: String,
    backspaces: u32,
    line_break_mode: Option<String>,
) -> Result<(), String> {
    log_key_event(&app, &state, &text, "type_text_incremental");
    // Send backspaces to erase previous partial text
    for _ in 0..backspaces {
        send_backspace_native()?;
    }
    // Small delay between erasing and typing
    if backspaces > 0 {
        thread::sleep(Duration::from_millis(10));
    }
    send_text_native(
        &text,
        LineBreakMode::from_str(line_break_mode.as_deref().unwrap_or("enter")),
    )
}

// ── Windows implementation ──────────────────────────────────────────

#[cfg(target_os = "windows")]
fn send_text_native(text: &str, line_break_mode: LineBreakMode) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_CONTROL, VK_RETURN, VK_SHIFT,
    };

    fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
        if inputs.is_empty() {
            return Ok(());
        }

        let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent == 0 {
            Err("SendInput failed".to_string())
        } else {
            Ok(())
        }
    }

    fn modifier_vk(line_break_mode: LineBreakMode) -> Option<VIRTUAL_KEY> {
        match line_break_mode {
            LineBreakMode::Enter => None,
            LineBreakMode::ShiftEnter => Some(VK_SHIFT),
            LineBreakMode::CtrlEnter => Some(VK_CONTROL),
        }
    }

    fn key_input(vk: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    for action in build_typing_actions(text) {
        match action {
            TypingAction::Text(chunk) => {
                let mut inputs: Vec<INPUT> = Vec::new();

                for c in chunk.chars() {
                    let mut buf = [0u16; 2];
                    let encoded = c.encode_utf16(&mut buf);

                    for code_unit in encoded.iter().copied() {
                        inputs.push(INPUT {
                            r#type: INPUT_KEYBOARD,
                            Anonymous: INPUT_0 {
                                ki: KEYBDINPUT {
                                    wVk: VIRTUAL_KEY(0),
                                    wScan: code_unit,
                                    dwFlags: KEYEVENTF_UNICODE,
                                    time: 0,
                                    dwExtraInfo: 0,
                                },
                            },
                        });
                        inputs.push(INPUT {
                            r#type: INPUT_KEYBOARD,
                            Anonymous: INPUT_0 {
                                ki: KEYBDINPUT {
                                    wVk: VIRTUAL_KEY(0),
                                    wScan: code_unit,
                                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                                    time: 0,
                                    dwExtraInfo: 0,
                                },
                            },
                        });
                    }
                }

                send_inputs(&inputs)?;
            }
            TypingAction::Newline => {
                let mut newline_inputs = Vec::new();
                if let Some(modifier) = modifier_vk(line_break_mode) {
                    newline_inputs.push(key_input(modifier, false));
                }
                newline_inputs.push(key_input(VK_RETURN, false));
                newline_inputs.push(key_input(VK_RETURN, true));
                if let Some(modifier) = modifier_vk(line_break_mode) {
                    newline_inputs.push(key_input(modifier, true));
                }
                send_inputs(&newline_inputs)?;
                thread::sleep(Duration::from_millis(NEWLINE_KEY_DELAY_MS));
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn send_backspace_native() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_BACK,
    };

    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_BACK,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_BACK,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };

    if sent == 0 {
        Err("SendInput failed for backspace".to_string())
    } else {
        Ok(())
    }
}

// ── Stub for non-Windows platforms ──────────────────────────────────

#[cfg(not(target_os = "windows"))]
fn send_text_native(text: &str, _line_break_mode: LineBreakMode) -> Result<(), String> {
    Err("Keyboard simulation not implemented for this platform. \
         implement using xdotool (Linux) or CGEventPost (macOS)."
        .to_string())
}

#[cfg(not(target_os = "windows"))]
fn send_backspace_native() -> Result<(), String> {
    Err("Keyboard simulation not implemented for this platform.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{build_typing_actions, LineBreakMode, TypingAction};

    #[test]
    fn preserves_consecutive_newlines_as_separate_actions() {
        assert_eq!(
            build_typing_actions("a\n\nb"),
            vec![
                TypingAction::Text("a".to_string()),
                TypingAction::Newline,
                TypingAction::Newline,
                TypingAction::Text("b".to_string())
            ]
        );
    }

    #[test]
    fn ignores_carriage_returns_when_building_actions() {
        assert_eq!(
            build_typing_actions("a\r\n\r\nb"),
            vec![
                TypingAction::Text("a".to_string()),
                TypingAction::Newline,
                TypingAction::Newline,
                TypingAction::Text("b".to_string())
            ]
        );
    }

    #[test]
    fn parses_line_break_modes() {
        assert_eq!(LineBreakMode::from_str("enter"), LineBreakMode::Enter);
        assert_eq!(
            LineBreakMode::from_str("shift_enter"),
            LineBreakMode::ShiftEnter
        );
        assert_eq!(
            LineBreakMode::from_str("ctrl_enter"),
            LineBreakMode::CtrlEnter
        );
        assert_eq!(LineBreakMode::from_str("unknown"), LineBreakMode::Enter);
    }
}

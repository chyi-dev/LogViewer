use crate::error::AppResult;
use crate::rules::pack::{CommandDef, DecodeStep, RulePack, ViewBlock};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ByteNote {
    pub hex: String,
    pub text: String,
    pub fault: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DisplayBlock {
    Heading { text: String },
    Kv {
        label: String,
        value: String,
        fault: bool,
    },
    Status {
        label: String,
        value: String,
        fault: bool,
    },
    Flags { items: Vec<String> },
    Hex { label: String, value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseEvent {
    pub id: String,
    pub dir: String,
    pub fault: bool,
    pub line: usize,
    pub cmd: Option<u8>,
    pub title: String,
    pub bytes: Vec<ByteNote>,
    /// Default card body: folded fields as hex：text；
    #[serde(default)]
    pub clauses: Vec<ByteNote>,
    /// Explicit view blocks when command.view is set.
    #[serde(default)]
    pub blocks: Vec<DisplayBlock>,
}

pub struct CompiledPack {
    pub pack: RulePack,
    line_res: Vec<(Regex, usize)>,
}

impl CompiledPack {
    pub fn compile(pack: RulePack) -> AppResult<Self> {
        let mut line_res = Vec::new();
        for (idx, rule) in pack.line_rules.iter().enumerate() {
            line_res.push((Regex::new(&rule.pattern)?, idx));
        }
        Ok(Self { pack, line_res })
    }
}

pub fn parse_document(pack: &CompiledPack, text: &str) -> Vec<ParseEvent> {
    let mut session = ParserSession::new(pack);
    for (i, line) in text.split('\n').enumerate() {
        session.push_line(i + 1, line.trim_end_matches('\r'));
    }
    session.finish()
}

pub fn parse_lines(pack: &CompiledPack, lines: &[(usize, &str)]) -> Vec<ParseEvent> {
    let mut session = ParserSession::new(pack);
    for &(line_no, line) in lines {
        session.push_line(line_no, line);
    }
    session.finish()
}

#[derive(Debug, Clone, Copy)]
struct LastTx {
    cmd: u8,
    sub: Option<u8>,
}

pub struct ParserSession<'a> {
    pack: &'a CompiledPack,
    events: Vec<ParseEvent>,
    last_tx: Option<LastTx>,
}

impl<'a> ParserSession<'a> {
    pub fn new(pack: &'a CompiledPack) -> Self {
        Self {
            pack,
            events: Vec::new(),
            last_tx: None,
        }
    }

    pub fn push_line(&mut self, line_no: usize, line: &str) {
        let line = line.trim_end_matches('\r');
        if let Some(ev) = parse_line(self.pack, line_no, line, &mut self.last_tx) {
            self.events.push(ev);
        }
    }

    pub fn finish(self) -> Vec<ParseEvent> {
        self.events
    }
}

fn parse_hex_bytes(s: &str) -> Option<Vec<u8>> {
    let cleaned = s.split_whitespace().collect::<Vec<_>>().join("");
    if cleaned.is_empty() || cleaned.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(cleaned.len() / 2);
    for i in (0..cleaned.len()).step_by(2) {
        out.push(u8::from_str_radix(&cleaned[i..i + 2], 16).ok()?);
    }
    Some(out)
}

fn checksum_ok(frame: &[u8]) -> bool {
    if frame.len() < 3 {
        return false;
    }
    let sum: u8 = frame[..frame.len() - 1]
        .iter()
        .fold(0u8, |a, b| a.wrapping_add(*b));
    sum == frame[frame.len() - 1]
}

fn sum8_tail_ok(frame: &[u8]) -> bool {
    if frame.len() < 2 {
        return false;
    }
    let sum: u8 = frame[..frame.len() - 1]
        .iter()
        .fold(0u8, |a, b| a.wrapping_add(*b));
    sum == frame[frame.len() - 1]
}

fn matches_header(bytes: &[u8], header: &[u8]) -> bool {
    bytes.len() >= header.len() && &bytes[..header.len()] == header
}

fn note(hex: u8, text: impl Into<String>, fault: bool) -> ByteNote {
    ByteNote {
        hex: format!("{hex:02X}"),
        text: text.into(),
        fault,
    }
}

fn is_mdb_adapter(pack: &CompiledPack) -> bool {
    pack.pack.frame.kind == "mdb_adapter"
}

fn parse_line(
    pack: &CompiledPack,
    line_no: usize,
    line: &str,
    last_tx: &mut Option<LastTx>,
) -> Option<ParseEvent> {
    for (re, rule_idx) in &pack.line_res {
        let caps = match re.captures(line) {
            Some(c) => c,
            None => continue,
        };
        let rule = &pack.pack.line_rules[*rule_idx];
        let dir_raw = caps.get(rule.dir_group)?.as_str();
        let dir = rule.dir_map.get(dir_raw)?.clone();
        let hex = caps.get(rule.hex_group)?.as_str();
        let bytes = parse_hex_bytes(hex)?;
        if is_mdb_adapter(pack) {
            return Some(decode_mdb_frame(pack, line_no, &dir, &bytes, last_tx));
        }
        return Some(decode_frame(pack, line_no, &dir, &bytes));
    }
    None
}

fn format_hex_frame(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn empty_card_fields() -> (Vec<ByteNote>, Vec<DisplayBlock>) {
    (Vec::new(), Vec::new())
}

fn raw_hex_event(line_no: usize, dir: &str, bytes: &[u8], fault: bool) -> ParseEvent {
    let hex = format_hex_frame(bytes);
    let (clauses, blocks) = empty_card_fields();
    ParseEvent {
        id: format!("L{line_no}"),
        dir: dir.to_string(),
        fault,
        line: line_no,
        cmd: None,
        title: hex.clone(),
        bytes: vec![ByteNote {
            hex: hex.clone(),
            text: hex,
            fault,
        }],
        clauses,
        blocks,
    }
}

fn default_mdb_bases() -> Vec<u8> {
    vec![
        0x08, 0x10, 0x18, 0x30, 0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70,
    ]
}

fn mdb_device_bases(pack: &CompiledPack) -> Vec<u8> {
    if pack.pack.frame.device_bases.is_empty() {
        default_mdb_bases()
    } else {
        pack.pack.frame.device_bases.clone()
    }
}

fn role_of(cmd: &CommandDef) -> &str {
    cmd.role.as_deref().unwrap_or("command")
}

fn score_mdb_command(cmd: &CommandDef, dir: &str, bytes: &[u8], expect_role: &str) -> Option<i32> {
    if role_of(cmd) != expect_role {
        return None;
    }
    if let Some(d) = cmd.dir.as_deref() {
        if d != dir {
            return None;
        }
    }
    if bytes.is_empty() {
        return None;
    }
    if let Some(len) = cmd.len {
        if bytes.len() != len {
            return None;
        }
    }
    let mut score = 0;
    match expect_role {
        "control" => {
            if bytes.len() != 1 || bytes[0] != cmd.cmd {
                return None;
            }
            score += 10;
        }
        "command" => {
            if bytes[0] != cmd.cmd {
                return None;
            }
            score += 4;
            if let Some(sub) = cmd.sub {
                if bytes.len() < 2 || bytes[1] != sub {
                    return None;
                }
                score += 6;
            }
            if cmd.len.is_some() {
                score += 4;
            }
        }
        "report" => {
            if bytes[0] != cmd.cmd {
                return None;
            }
            score += 4;
            if let Some(sub) = cmd.sub {
                if bytes.len() < 2 || bytes[1] != sub {
                    return None;
                }
                score += 6;
            }
            if cmd.len.is_some() {
                score += 4;
            }
        }
        "event" => {
            // Poll/event data reply without device ID prefix; first byte is event code.
            if bytes[0] != cmd.cmd {
                return None;
            }
            score += 5;
            if let Some(sub) = cmd.sub {
                if bytes.len() < 2 || bytes[1] != sub {
                    return None;
                }
                score += 4;
            }
            if cmd.len.is_some() {
                score += 4;
            }
        }
        "reply" => {
            // Reply matching uses last TX cmd/sub; byte[0] is not the command.
            score += 2;
            if cmd.len.is_some() {
                score += 4;
            }
        }
        _ => return None,
    }
    Some(score)
}

fn find_mdb_command<'a>(
    pack: &'a CompiledPack,
    dir: &str,
    bytes: &[u8],
    expect_role: &str,
    reply_bind: Option<LastTx>,
) -> Option<&'a CommandDef> {
    let mut best: Option<(&CommandDef, i32)> = None;
    for cmd in &pack.pack.commands {
        if expect_role == "reply" {
            let Some(bind) = reply_bind else {
                continue;
            };
            if cmd.cmd != bind.cmd {
                continue;
            }
            match (cmd.sub, bind.sub) {
                (Some(a), Some(b)) if a == b => {}
                (Some(_), _) => continue,
                (None, _) => {}
            }
            if let Some(d) = cmd.dir.as_deref() {
                if d != dir {
                    continue;
                }
            }
            if role_of(cmd) != "reply" {
                continue;
            }
            if let Some(len) = cmd.len {
                if bytes.len() != len {
                    continue;
                }
            }
            let mut score = 2;
            if cmd.sub.is_some() {
                score += 6;
            }
            if cmd.len.is_some() {
                score += 4;
            }
            if best.map(|(_, s)| score > s).unwrap_or(true) {
                best = Some((cmd, score));
            }
            continue;
        }
        if let Some(score) = score_mdb_command(cmd, dir, bytes, expect_role) {
            if best.map(|(_, s)| score > s).unwrap_or(true) {
                best = Some((cmd, score));
            }
        }
    }
    best.map(|(c, _)| c)
}

fn mdb_payload<'a>(cmd: &CommandDef, bytes: &'a [u8], role: &str) -> &'a [u8] {
    let checksum = cmd.checksum.as_deref().unwrap_or(match role {
        "reply" | "event" => "sum8_tail",
        _ => "none",
    });
    let body = if checksum == "sum8_tail" && bytes.len() >= 2 {
        &bytes[..bytes.len() - 1]
    } else {
        bytes
    };
    match role {
        "command" | "report" => {
            if cmd.sub.is_some() {
                if body.len() >= 2 {
                    &body[2..]
                } else {
                    &[]
                }
            } else if !body.is_empty() {
                &body[1..]
            } else {
                &[]
            }
        }
        "event" => {
            // First byte is event code; remaining body (ex checksum) is payload.
            if body.len() > 1 {
                &body[1..]
            } else {
                &[]
            }
        }
        "reply" | "control" => body,
        _ => body,
    }
}

fn finish_mdb_event(
    line_no: usize,
    dir: &str,
    bytes: &[u8],
    cmd_byte: Option<u8>,
    command: Option<&CommandDef>,
    payload: &[u8],
    fault: bool,
) -> ParseEvent {
    let title = command
        .map(|c| c.title.clone())
        .unwrap_or_else(|| match cmd_byte {
            Some(c) => format!("未知MDB帧 0x{c:02X}"),
            None => "未知MDB帧".into(),
        });

    let mut payload_labels: Vec<(String, bool)> = (0..payload.len())
        .map(|_| ("载荷".into(), false))
        .collect();
    let mut field_table: Option<FieldTable> = None;
    let mut fault = fault;

    if let Some(cmd_def) = command {
        let want_fields = !cmd_def.view.is_empty();
        let ann = annotate_payload(cmd_def, payload, want_fields);
        fault |= ann.fault;
        for (i, (text, hot)) in ann.labels.into_iter().enumerate() {
            if i < payload_labels.len() {
                payload_labels[i] = (text, hot);
            }
        }
        field_table = ann.fields;
    }

    let mut notes: Vec<ByteNote> = Vec::new();
    if let Some(cmd_def) = command {
        let role = role_of(cmd_def);
        let checksum = cmd_def.checksum.as_deref().unwrap_or(match role {
            "reply" | "event" => "sum8_tail",
            _ => "none",
        });
        let has_chk = checksum == "sum8_tail" && bytes.len() >= 2;
        let data_end = if has_chk { bytes.len() - 1 } else { bytes.len() };

        match role {
            "control" => {
                notes.push(note(bytes[0], &title, fault));
            }
            "command" | "report" => {
                notes.push(note(bytes[0], if role == "report" { "设备地址" } else { "命令" }, false));
                let mut payload_idx = 0usize;
                let start = if cmd_def.sub.is_some() {
                    if bytes.len() > 1 {
                        notes.push(note(
                            bytes[1],
                            if role == "report" { "事件" } else { "子命令" },
                            false,
                        ));
                    }
                    2
                } else {
                    1
                };
                for i in start..data_end {
                    let (text, hot) = payload_labels
                        .get(payload_idx)
                        .cloned()
                        .unwrap_or_else(|| ("载荷".into(), false));
                    notes.push(note(bytes[i], text, hot));
                    payload_idx += 1;
                }
                if has_chk {
                    notes.push(note(bytes[bytes.len() - 1], "校验", fault && !sum8_tail_ok(bytes)));
                }
            }
            "event" => {
                notes.push(note(bytes[0], "事件", false));
                for i in 1..data_end {
                    let (text, hot) = payload_labels
                        .get(i - 1)
                        .cloned()
                        .unwrap_or_else(|| ("载荷".into(), false));
                    notes.push(note(bytes[i], text, hot));
                }
                if has_chk {
                    let chk_fault = !sum8_tail_ok(bytes);
                    notes.push(note(bytes[bytes.len() - 1], "校验", chk_fault));
                }
            }
            "reply" => {
                for i in 0..data_end {
                    let (text, hot) = payload_labels
                        .get(i)
                        .cloned()
                        .unwrap_or_else(|| ("载荷".into(), false));
                    notes.push(note(bytes[i], text, hot));
                }
                if has_chk {
                    let chk_fault = !sum8_tail_ok(bytes);
                    notes.push(note(bytes[bytes.len() - 1], "校验", chk_fault));
                }
            }
            _ => {
                for &b in bytes {
                    notes.push(note(b, "载荷", fault));
                }
            }
        }
    } else {
        for &b in bytes {
            notes.push(note(b, "无法识别", true));
        }
        fault = true;
    }

    let notes = significant_byte_notes(&notes);
    let (out_bytes, clauses, blocks) = if let Some(cmd_def) = command {
        if !cmd_def.view.is_empty() {
            let table = field_table.unwrap_or_default();
            let resolved = resolve_view(cmd_def, &title, payload, &table);
            if resolved.is_empty() {
                (Vec::new(), notes, Vec::new())
            } else {
                (Vec::new(), Vec::new(), resolved)
            }
        } else {
            (Vec::new(), notes, Vec::new())
        }
    } else {
        (notes, Vec::new(), Vec::new())
    };

    ParseEvent {
        id: format!("L{line_no}-{}", format_hex_frame(bytes).replace(' ', "")),
        dir: dir.to_string(),
        fault,
        line: line_no,
        cmd: cmd_byte,
        title,
        bytes: out_bytes,
        clauses,
        blocks,
    }
}

fn decode_mdb_frame(
    pack: &CompiledPack,
    line_no: usize,
    dir: &str,
    bytes: &[u8],
    last_tx: &mut Option<LastTx>,
) -> ParseEvent {
    if pack.pack.presentation == "raw_hex" {
        return raw_hex_event(line_no, dir, bytes, false);
    }
    if bytes.is_empty() {
        return finish_mdb_event(line_no, dir, bytes, None, None, &[], true);
    }

    if dir == "tx" {
        let command = find_mdb_command(pack, dir, bytes, "command", None);
        if let Some(cmd) = command {
            *last_tx = Some(LastTx {
                cmd: cmd.cmd,
                sub: cmd.sub,
            });
        } else {
            *last_tx = Some(LastTx {
                cmd: bytes[0],
                sub: None,
            });
        }
        let payload = command
            .map(|c| mdb_payload(c, bytes, "command"))
            .unwrap_or(&bytes[1.min(bytes.len())..]);
        let mut fault = false;
        if let Some(cmd) = command {
            if cmd.checksum.as_deref() == Some("sum8_tail") {
                fault = !sum8_tail_ok(bytes);
            }
        }
        return finish_mdb_event(
            line_no,
            dir,
            bytes,
            Some(bytes[0]),
            command,
            payload,
            fault,
        );
    }

    // RX
    if bytes.len() == 1 {
        if let Some(command) = find_mdb_command(pack, dir, bytes, "control", None) {
            return finish_mdb_event(
                line_no,
                dir,
                bytes,
                Some(bytes[0]),
                Some(command),
                &[],
                false,
            );
        }
    }

    let bases = mdb_device_bases(pack);
    if bases.contains(&bytes[0]) && bytes.len() >= 2 {
        if let Some(command) = find_mdb_command(pack, dir, bytes, "report", None) {
            let payload = mdb_payload(command, bytes, "report");
            return finish_mdb_event(
                line_no,
                dir,
                bytes,
                Some(bytes[0]),
                Some(command),
                payload,
                false,
            );
        }
        // Device-prefixed but unknown event — still treat as report.
        return finish_mdb_event(
            line_no,
            dir,
            bytes,
            Some(bytes[0]),
            None,
            &bytes[1..],
            true,
        );
    }

    // Poll/event data reply without device prefix (e.g. 06 06 Vend Denied).
    if let Some(command) = find_mdb_command(pack, dir, bytes, "event", None) {
        let checksum = command.checksum.as_deref().unwrap_or("sum8_tail");
        let mut fault = false;
        if checksum == "sum8_tail" {
            fault = !sum8_tail_ok(bytes);
        }
        let payload = mdb_payload(command, bytes, "event");
        return finish_mdb_event(
            line_no,
            dir,
            bytes,
            Some(bytes[0]),
            Some(command),
            payload,
            fault,
        );
    }

    // Command reply (optional checksum), bound to last TX.
    let bind = *last_tx;
    if let Some(command) = find_mdb_command(pack, dir, bytes, "reply", bind) {
        let checksum = command.checksum.as_deref().unwrap_or("sum8_tail");
        let mut fault = false;
        if checksum == "sum8_tail" {
            fault = !sum8_tail_ok(bytes);
        }
        let payload = mdb_payload(command, bytes, "reply");
        return finish_mdb_event(
            line_no,
            dir,
            bytes,
            bind.map(|t| t.cmd),
            Some(command),
            payload,
            fault,
        );
    }

    finish_mdb_event(line_no, dir, bytes, bytes.first().copied(), None, bytes, true)
}

fn decode_frame(pack: &CompiledPack, line_no: usize, dir: &str, bytes: &[u8]) -> ParseEvent {
    let frame_def = &pack.pack.frame;
    let header_ok = if dir == "tx" {
        matches_header(bytes, &frame_def.tx_header)
    } else {
        matches_header(bytes, &frame_def.rx_header)
    };
    let header_len = if dir == "tx" {
        frame_def.tx_header.len()
    } else {
        frame_def.rx_header.len()
    };

    if pack.pack.presentation == "raw_hex" {
        let mut fault = !header_ok || bytes.len() < header_len + 2;
        if !fault {
            let len_byte = bytes[header_len] as usize;
            let expected_total = header_len + 1 + len_byte;
            fault = bytes.len() != expected_total || !checksum_ok(bytes);
        }
        return raw_hex_event(line_no, dir, bytes, fault);
    }

    if !header_ok || bytes.len() < header_len + 2 {
        let notes: Vec<ByteNote> = bytes
            .iter()
            .enumerate()
            .map(|(i, &b)| {
                let text = if i < header_len {
                    if header_ok {
                        "帧头"
                    } else {
                        "帧头无效"
                    }
                } else {
                    "无法识别"
                };
                note(b, text, true)
            })
            .collect();
        let (clauses, blocks) = empty_card_fields();
        return ParseEvent {
            id: format!("L{line_no}"),
            dir: dir.to_string(),
            fault: true,
            line: line_no,
            cmd: None,
            title: "无法识别帧".into(),
            bytes: significant_byte_notes(&notes),
            clauses,
            blocks,
        };
    }

    let len_byte = bytes[header_len] as usize;
    let expected_total = header_len + 1 + len_byte;
    let len_ok = bytes.len() == expected_total;
    let chk_ok = checksum_ok(bytes);

    let cmd = if bytes.len() > header_len + 1 {
        Some(bytes[header_len + 1])
    } else {
        None
    };

    let payload_start = header_len + 2;
    let payload_end = if expected_total >= header_len + 3 {
        (expected_total - 1).min(bytes.len())
    } else {
        bytes.len().saturating_sub(1)
    };
    let payload = if payload_start < payload_end {
        &bytes[payload_start..payload_end]
    } else {
        &[][..]
    };

    let command = cmd.and_then(|c| pack.pack.commands.iter().find(|d| d.cmd == c));
    let (title, cmd_label) = if let Some(cmd_def) = command {
        let title = if dir == "tx" {
            cmd_def.title.clone()
        } else {
            format!("{}应答", cmd_def.title.trim_start_matches("查询"))
        };
        (title.clone(), title)
    } else {
        let title = match cmd {
            Some(c) => format!("未知命令 0x{c:02X}"),
            None => "未知帧".into(),
        };
        (title.clone(), title)
    };

    let mut payload_labels: Vec<(String, bool)> = (0..payload.len())
        .map(|_| ("载荷".into(), false))
        .collect();
    let mut fault = !len_ok || !chk_ok;
    let mut field_table: Option<FieldTable> = None;

    if let Some(cmd_def) = command {
        let want_fields = !cmd_def.view.is_empty();
        let ann = annotate_payload(cmd_def, payload, want_fields);
        fault |= ann.fault;
        for (i, (text, hot)) in ann.labels.into_iter().enumerate() {
            if i < payload_labels.len() {
                payload_labels[i] = (text, hot);
            }
        }
        field_table = ann.fields;
    }

    let notes = significant_byte_notes(&build_frame_notes(
        bytes,
        header_len,
        len_byte,
        len_ok,
        chk_ok,
        cmd,
        &cmd_label,
        payload,
        &payload_labels,
        expected_total,
    ));

    let (out_bytes, clauses, blocks) = if let Some(cmd_def) = command {
        if !cmd_def.view.is_empty() {
            let table = field_table.unwrap_or_default();
            let resolved = resolve_view(cmd_def, &title, payload, &table);
            if resolved.is_empty() {
                (Vec::new(), notes, Vec::new())
            } else {
                (Vec::new(), Vec::new(), resolved)
            }
        } else {
            (Vec::new(), notes, Vec::new())
        }
    } else {
        (notes, Vec::new(), Vec::new())
    };

    ParseEvent {
        id: format!(
            "L{line_no}-{}",
            cmd.map(|c| format!("{c:02X}")).unwrap_or_default()
        ),
        dir: dir.to_string(),
        fault,
        line: line_no,
        cmd,
        title,
        bytes: out_bytes,
        clauses,
        blocks,
    }
}

fn is_structural_note(text: &str) -> bool {
    text == "帧头"
        || text == "帧头无效"
        || text.starts_with("长度 ")
        || text == "校验通过"
}

fn note_base(text: &str) -> &str {
    text.split_once("  ").map(|(a, _)| a).unwrap_or(text)
}

/// Drop frame plumbing and collapse multi-byte fields into one row.
fn significant_byte_notes(notes: &[ByteNote]) -> Vec<ByteNote> {
    let interesting: Vec<&ByteNote> = notes
        .iter()
        .filter(|n| !is_structural_note(&n.text))
        .collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < interesting.len() {
        let base = note_base(&interesting[i].text);
        let mut j = i + 1;
        while j < interesting.len() && note_base(&interesting[j].text) == base {
            j += 1;
        }
        let hex = interesting[i..j]
            .iter()
            .map(|n| n.hex.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let last = interesting[j - 1];
        let fault = interesting[i..j].iter().any(|n| n.fault);
        out.push(ByteNote {
            hex,
            text: last.text.clone(),
            fault,
        });
        i = j;
    }
    out
}

fn build_frame_notes(
    bytes: &[u8],
    header_len: usize,
    len_byte: usize,
    len_ok: bool,
    chk_ok: bool,
    cmd: Option<u8>,
    cmd_label: &str,
    payload: &[u8],
    payload_labels: &[(String, bool)],
    expected_total: usize,
) -> Vec<ByteNote> {
    let mut notes = Vec::with_capacity(bytes.len());
    for &b in &bytes[..header_len] {
        notes.push(note(b, "帧头", false));
    }
    if header_len < bytes.len() {
        notes.push(note(bytes[header_len], format!("长度 {len_byte}"), !len_ok));
    }
    if header_len + 1 < bytes.len() {
        if let Some(c) = cmd {
            notes.push(note(c, cmd_label.to_string(), false));
        }
    }
    for (i, &b) in payload.iter().enumerate() {
        let (text, hot) = payload_labels
            .get(i)
            .cloned()
            .unwrap_or_else(|| ("载荷".into(), false));
        notes.push(note(b, text, hot));
    }

    let chk_pos = expected_total.saturating_sub(1);
    if chk_pos >= header_len + 2 && chk_pos < bytes.len() && notes.len() == chk_pos {
        notes.push(note(
            bytes[chk_pos],
            if chk_ok { "校验通过" } else { "校验失败" },
            !chk_ok,
        ));
    } else if notes.len() < bytes.len() && notes.len() == header_len + 2 + payload.len() {
        // checksum immediately after payload when expected matches
        let i = notes.len();
        if i == chk_pos {
            notes.push(note(
                bytes[i],
                if chk_ok { "校验通过" } else { "校验失败" },
                !chk_ok,
            ));
        }
    }

    while notes.len() < bytes.len() {
        let i = notes.len();
        if i == chk_pos {
            notes.push(note(
                bytes[i],
                if chk_ok { "校验通过" } else { "校验失败" },
                !chk_ok,
            ));
        } else if i > chk_pos {
            notes.push(note(bytes[i], "多余字节", true));
        } else {
            notes.push(note(bytes[i], "载荷", false));
        }
    }

    notes
}

#[derive(Debug, Clone, Default)]
struct FieldEntry {
    label: String,
    value: String,
    hex: String,
    fault: bool,
}

#[derive(Debug, Clone, Default)]
struct FieldTable {
    fields: HashMap<String, FieldEntry>,
    /// Fault descriptions keyed by flags/groups bind id (and from/code aliases).
    flag_hits: HashMap<String, Vec<String>>,
}

struct PayloadAnnotation {
    labels: Vec<(String, bool)>,
    fault: bool,
    fields: Option<FieldTable>,
}

fn is_fault_code_token(tok: &str) -> bool {
    let t: String = tok
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let b = t.as_bytes();
    b.len() >= 2
        && (b[0] == b'E' || b[0] == b'A' || b[0] == b'e' || b[0] == b'a')
        && b[1..].iter().all(|c| c.is_ascii_digit())
}

/// Strip embedded fault codes like E14 / A01 / A04 from display text.
fn strip_fault_codes(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if matches!(c, 'E' | 'A' | 'e' | 'a') {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            let prev_ok = i == 0 || !chars[i - 1].is_ascii_alphanumeric();
            let next_ok = j >= chars.len() || !chars[j].is_ascii_alphanumeric();
            if j > i + 1 && prev_ok && next_ok {
                i = j;
                if i < chars.len() && chars[i] == ' ' {
                    i += 1;
                }
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Keep human-readable fault text; drop codes like E14 / A01 / A04.
fn fault_description(label: &str, code: Option<&str>) -> String {
    let mut s = label.to_string();
    if let Some(c) = code {
        s = s.replace(c, "");
    }
    s = strip_fault_codes(&s);
    s = s
        .split_whitespace()
        .filter(|tok| !is_fault_code_token(tok))
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(pos) = s.rfind('→') {
        s = s[pos + '→'.len_utf8()..].trim().to_string();
    }
    let bytes = s.as_bytes();
    let mut i = 0usize;
    if i < bytes.len() && (bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') {
        i += 1;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            i += 1;
        }
        if i < bytes.len() && bytes[i].is_ascii_whitespace() {
            let rest = s[i..].trim();
            if rest.chars().any(|c| !c.is_ascii()) {
                s = rest.to_string();
            }
        }
    }
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn annotate_payload(cmd: &CommandDef, payload: &[u8], want_fields: bool) -> PayloadAnnotation {
    let mut labels: Vec<(String, bool)> = (0..payload.len())
        .map(|_| ("载荷".into(), false))
        .collect();
    let mut values: HashMap<String, u64> = HashMap::new();
    let mut field_ranges: HashMap<String, (usize, usize)> = HashMap::new();
    let mut fault = false;
    let mut extras: HashMap<usize, Vec<String>> = HashMap::new();
    let mut hot_at: HashMap<usize, bool> = HashMap::new();
    let mut table = FieldTable::default();

    for step in &cmd.decode {
        match step {
            DecodeStep::Uint {
                id,
                offset,
                width,
                endian,
                label,
            } => {
                if let Some(v) = read_uint(payload, *offset, *width, endian) {
                    values.insert(id.clone(), v);
                    field_ranges.insert(id.clone(), (*offset, *width));
                    let name = label.clone().unwrap_or_else(|| id.clone());
                    for i in *offset..(*offset + *width).min(payload.len()) {
                        labels[i] = (name.clone(), false);
                    }
                    if want_fields {
                        let hex = payload
                            .get(*offset..(*offset + *width).min(payload.len()))
                            .unwrap_or(&[])
                            .iter()
                            .map(|b| format!("{b:02X}"))
                            .collect::<Vec<_>>()
                            .join(" ");
                        let value = format!("{:0width$X}", v, width = (*width).saturating_mul(2).max(1));
                        table.fields.insert(
                            id.clone(),
                            FieldEntry {
                                label: name,
                                value,
                                hex,
                                fault: false,
                            },
                        );
                    }
                }
            }
            DecodeStep::Bits {
                from,
                start,
                width,
                id,
                map,
                label,
            } => {
                if let Some(v) = values.get(from) {
                    let mask = if *width >= 64 {
                        u64::MAX
                    } else {
                        (1u64 << width) - 1
                    };
                    let part = (v >> start) & mask;
                    values.insert(id.clone(), part);
                    let mapped = map
                        .get(&part.to_string())
                        .cloned()
                        .unwrap_or_else(|| part.to_string());
                    let mut hot = false;
                    let is_status = id == "status" || label.as_deref() == Some("status");
                    if is_status && part >= 2 {
                        fault = true;
                        hot = true;
                    }
                    if want_fields {
                        let name = label.clone().unwrap_or_else(|| id.clone());
                        table.fields.insert(
                            id.clone(),
                            FieldEntry {
                                label: name,
                                value: mapped.clone(),
                                hex: String::new(),
                                fault: hot,
                            },
                        );
                    }
                    if let Some(&(off, w)) = field_ranges.get(from) {
                        let last = off + w - 1;
                        if last < payload.len() {
                            extras.entry(last).or_default().push(mapped);
                            if hot {
                                hot_at.insert(last, true);
                            }
                        }
                    }
                }
            }
            DecodeStep::Flags { from, bits, id, .. } => {
                if let Some(v) = values.get(from) {
                    let mut hits = Vec::new();
                    for bit in bits {
                        let on = (v & (1u64 << bit.bit)) != 0;
                        if on && bit.fault {
                            fault = true;
                            hits.push(fault_description(
                                &bit.label,
                                bit.code.as_deref(),
                            ));
                        }
                    }
                    if want_fields && !hits.is_empty() {
                        let cleaned: Vec<String> = hits
                            .iter()
                            .map(|h| fault_description(h, None))
                            .filter(|h| !h.is_empty())
                            .collect();
                        table.flag_hits.insert(from.clone(), cleaned.clone());
                        if let Some(id) = id {
                            table.flag_hits.insert(id.clone(), cleaned);
                        }
                    }
                    if !hits.is_empty() {
                        if let Some(&(off, w)) = field_ranges.get(from) {
                            let last = off + w - 1;
                            if last < payload.len() {
                                extras.entry(last).or_default().extend(hits);
                                hot_at.insert(last, true);
                            }
                        }
                    }
                }
            }
            DecodeStep::Groups {
                from_bytes,
                from,
                group_bits,
                equals,
                code,
                label,
                reorder,
                id,
            } => {
                let mut raw_val = if let Some(name) = from {
                    values.get(name).copied()
                } else {
                    None
                };
                let mut range: Option<(usize, usize)> = from
                    .as_ref()
                    .and_then(|name| field_ranges.get(name).copied());
                if raw_val.is_none() {
                    if let Some((off, width)) = from_bytes {
                        let mut bytes = payload.get(*off..*off + *width).unwrap_or(&[]).to_vec();
                        if let Some(order) = reorder {
                            let mut reordered = vec![0u8; bytes.len()];
                            for (dst, &src) in order.iter().enumerate() {
                                if src < bytes.len() && dst < reordered.len() {
                                    reordered[dst] = bytes[src];
                                }
                            }
                            bytes = reordered;
                        }
                        raw_val = read_uint(&bytes, 0, bytes.len(), "be");
                        range = Some((*off, *width));
                        for i in *off..(*off + *width).min(payload.len()) {
                            if labels[i].0 == "载荷" {
                                // Neutral field name — fault text goes on the last byte via extras.
                                labels[i] = ("分组".into(), false);
                            }
                        }
                    }
                }
                if let Some(v) = raw_val {
                    let mask = (1u64 << group_bits) - 1;
                    let groups = 64 / (*group_bits as usize).max(1);
                    let mut hits = Vec::new();
                    let desc = fault_description(label, Some(code));
                    for g in 0..groups {
                        let shift = g as u8 * group_bits;
                        if shift >= 64 {
                            break;
                        }
                        let part = (v >> shift) & mask;
                        if part == *equals {
                            fault = true;
                            if !desc.is_empty() {
                                hits.push(desc.clone());
                            }
                        }
                    }
                    if !hits.is_empty() {
                        if want_fields {
                            let cleaned: Vec<String> = hits
                                .iter()
                                .map(|h| fault_description(h, None))
                                .filter(|h| !h.is_empty())
                                .collect();
                            table.flag_hits.insert(code.clone(), cleaned.clone());
                            if let Some(id) = id {
                                table.flag_hits.insert(id.clone(), cleaned.clone());
                            }
                            if let Some(from) = from {
                                table.flag_hits.insert(from.clone(), cleaned);
                            }
                        }
                        if let Some((off, w)) = range {
                            let last = off + w - 1;
                            if last < payload.len() {
                                extras.entry(last).or_default().extend(hits);
                                hot_at.insert(last, true);
                            }
                        }
                    }
                }
            }
            DecodeStep::HexDump { id, label } => {
                let name = label.clone().unwrap_or_else(|| "params".into());
                for item in labels.iter_mut() {
                    if item.0 == "载荷" {
                        item.0 = name.clone();
                    }
                }
                if want_fields {
                    let hex = format_hex_frame(payload);
                    table.fields.insert(
                        id.clone(),
                        FieldEntry {
                            label: name,
                            value: hex.clone(),
                            hex,
                            fault: false,
                        },
                    );
                }
            }
            DecodeStep::Ascii {
                id,
                offset,
                width,
                label,
            } => {
                if *offset < payload.len() {
                    let end = (*offset + *width).min(payload.len());
                    let slice = &payload[*offset..end];
                    for i in *offset..end {
                        let name = label.clone().unwrap_or_else(|| id.clone());
                        labels[i] = (name, false);
                    }
                    if want_fields {
                        let text = slice
                            .iter()
                            .copied()
                            .filter(|&b| b != 0 && b != b' ')
                            .map(|b| {
                                if (0x20..=0x7E).contains(&b) {
                                    b as char
                                } else {
                                    '.'
                                }
                            })
                            .collect::<String>();
                        let hex = format_hex_frame(slice);
                        let name = label.clone().unwrap_or_else(|| id.clone());
                        table.fields.insert(
                            id.clone(),
                            FieldEntry {
                                label: name,
                                value: if text.is_empty() { hex.clone() } else { text },
                                hex,
                                fault: false,
                            },
                        );
                    }
                }
            }
        }
    }

    for (idx, parts) in extras {
        if idx < labels.len() {
            let base = fault_description(&labels[idx].0, None);
            let joined = parts
                .into_iter()
                .map(|p| fault_description(&p, None))
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            labels[idx].0 = if base.is_empty() {
                joined
            } else if joined.is_empty() || joined == base || base.contains(&joined) {
                base
            } else if joined.contains(&base) {
                joined
            } else {
                format!("{base}  {joined}")
            };
            if hot_at.get(&idx) == Some(&true) {
                labels[idx].1 = true;
            }
        }
    }

    // Final pass: never leak fault codes into displayed labels.
    // Keep the "  " field/extras separator used by note_base collapse.
    for (text, _) in labels.iter_mut() {
        let mut cleaned = strip_fault_codes(text);
        while cleaned.contains("   ") {
            cleaned = cleaned.replace("   ", "  ");
        }
        *text = cleaned.trim().to_string();
    }

    PayloadAnnotation {
        labels,
        fault,
        fields: want_fields.then_some(table),
    }
}

fn resolve_view(
    cmd: &CommandDef,
    title: &str,
    payload: &[u8],
    table: &FieldTable,
) -> Vec<DisplayBlock> {
    let mut out = Vec::with_capacity(cmd.view.len());
    for block in &cmd.view {
        match block {
            ViewBlock::Heading { text } => {
                out.push(DisplayBlock::Heading {
                    text: text.clone().unwrap_or_else(|| title.to_string()),
                });
            }
            ViewBlock::Kv { bind, label } => {
                if let Some(f) = table.fields.get(bind) {
                    out.push(DisplayBlock::Kv {
                        label: label.clone().unwrap_or_else(|| f.label.clone()),
                        value: if f.value.is_empty() {
                            "—".into()
                        } else {
                            f.value.clone()
                        },
                        fault: f.fault,
                    });
                } else {
                    out.push(DisplayBlock::Kv {
                        label: label.clone().unwrap_or_else(|| bind.clone()),
                        value: "—".into(),
                        fault: false,
                    });
                }
            }
            ViewBlock::Status { bind } => {
                if let Some(f) = table.fields.get(bind) {
                    out.push(DisplayBlock::Status {
                        label: f.label.clone(),
                        value: if f.value.is_empty() {
                            "—".into()
                        } else {
                            f.value.clone()
                        },
                        fault: f.fault,
                    });
                } else {
                    out.push(DisplayBlock::Status {
                        label: bind.clone(),
                        value: "—".into(),
                        fault: false,
                    });
                }
            }
            ViewBlock::Flags { bind } => {
                if let Some(items) = table.flag_hits.get(bind) {
                    if !items.is_empty() {
                        out.push(DisplayBlock::Flags {
                            items: items.clone(),
                        });
                    }
                }
            }
            ViewBlock::Hex {
                bind,
                from_bytes,
                label,
            } => {
                let (name, value) = if let Some(b) = bind {
                    if let Some(f) = table.fields.get(b) {
                        (
                            label.clone().unwrap_or_else(|| f.label.clone()),
                            if f.hex.is_empty() {
                                f.value.clone()
                            } else {
                                f.hex.clone()
                            },
                        )
                    } else {
                        (label.clone().unwrap_or_else(|| b.clone()), "—".into())
                    }
                } else if let Some((off, width)) = from_bytes {
                    let slice = payload
                        .get(*off..(*off + *width).min(payload.len()))
                        .unwrap_or(&[]);
                    (
                        label.clone().unwrap_or_else(|| "载荷".into()),
                        if slice.is_empty() {
                            "—".into()
                        } else {
                            format_hex_frame(slice)
                        },
                    )
                } else {
                    (label.clone().unwrap_or_else(|| "载荷".into()), "—".into())
                };
                out.push(DisplayBlock::Hex {
                    label: name,
                    value,
                });
            }
        }
    }
    out
}

fn read_uint(payload: &[u8], offset: usize, width: usize, endian: &str) -> Option<u64> {
    if offset + width > payload.len() || width == 0 || width > 8 {
        return None;
    }
    let slice = &payload[offset..offset + width];
    let mut v = 0u64;
    if endian == "le" {
        for (i, b) in slice.iter().enumerate() {
            v |= (*b as u64) << (8 * i);
        }
    } else {
        for b in slice {
            v = (v << 8) | (*b as u64);
        }
    }
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::pack::parse_rulepack_json;

    const LENGTH_PREFIX_PACK: &str = r#"{
      "id":"test-length-prefix","name":"test-length-prefix","version":"1",
      "line_rules":[
        {
          "id":"device-arrow",
          "pattern":"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d+)\\s+Device:\\S+\\s+([><])\\s+([0-9A-Fa-f ]+)$",
          "dir_group":2,"dir_map":{">":"tx","<":"rx"},"hex_group":3,"time_group":1
        },
        {
          "id":"coffee-cn",
          "pattern":"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d+)\\s+Coffee-Machine:\\S*?---(发送|接收)：\\s*([0-9A-Fa-f ]+)$",
          "dir_group":2,"dir_map":{"发送":"tx","接收":"rx"},"hex_group":3,"time_group":1
        }
      ],
      "frame":{"tx_header":[170,85],"rx_header":[165,90],"checksum":"sum8_before_last"},
      "commands":[{
        "cmd":30,"name":"DeviceStatus","title":"查询设备状态",
        "decode":[
          {"type":"uint","id":"st_info1","offset":0,"width":4,"endian":"be","label":"ST_INFO1"},
          {"type":"bits","from":"st_info1","start":0,"width":2,"id":"status","label":"status",
            "map":{"0":"NORMAL","1":"BUSY","2":"ABNORMAL","3":"ERROR"}},
          {"type":"flags","from":"st_info1","bits":[
            {"bit":5,"label":"前门故障","fault":true},
            {"bit":9,"label":"A01 无盖","fault":true,"code":"A01"}
          ]}
        ]
      }]
    }"#;

    const RAW_HEX_PACK: &str = r#"{
      "id":"test-raw-hex","name":"test-raw-hex","version":"1",
      "presentation":"raw_hex",
      "line_rules":[{
        "id":"device-arrow",
        "pattern":"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d+)\\s+Device:\\S+\\s+([><])\\s+([0-9A-Fa-f ]+)$",
        "dir_group":2,"dir_map":{">":"tx","<":"rx"},"hex_group":3,"time_group":1
      }],
      "frame":{"tx_header":[170,85],"rx_header":[165,90],"checksum":"sum8_before_last"},
      "commands":[]
    }"#;

    const MDB_PACK: &str = r#"{
      "id":"test-mdb","name":"test-mdb","version":"1",
      "line_rules":[{
        "id":"payment-arrow",
        "pattern":"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d+)\\s+Payment:\\S+\\s+([><])\\s+([0-9A-Fa-f ]+)$",
        "dir_group":2,"dir_map":{">":"tx","<":"rx"},"hex_group":3,"time_group":1
      }],
      "frame":{"kind":"mdb_adapter","tx_header":[],"rx_header":[],"device_bases":[48]},
      "commands":[
        {"cmd":17,"sub":0,"dir":"tx","role":"command","checksum":"none","name":"Setup","title":"初始化"},
        {
          "cmd":17,"sub":0,"dir":"rx","role":"reply","checksum":"sum8_tail","name":"SetupReply","title":"配置应答",
          "decode":[
            {"type":"uint","id":"level","offset":1,"width":1,"endian":"be","label":"功能等级"}
          ]
        },
        {"cmd":0,"dir":"rx","role":"control","checksum":"none","name":"ACK","title":"ACK","len":1}
      ]
    }"#;

    fn length_prefix_pack() -> CompiledPack {
        CompiledPack::compile(parse_rulepack_json(LENGTH_PREFIX_PACK).unwrap()).unwrap()
    }

    fn raw_hex_pack() -> CompiledPack {
        CompiledPack::compile(parse_rulepack_json(RAW_HEX_PACK).unwrap()).unwrap()
    }

    fn mdb_pack() -> CompiledPack {
        CompiledPack::compile(parse_rulepack_json(MDB_PACK).unwrap()).unwrap()
    }

    #[test]
    fn raw_hex_shows_frame_only() {
        let text = "2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 06 1E 00 00 02 22 47\n";
        let decoded = parse_document(&length_prefix_pack(), text);
        assert_eq!(decoded.len(), 1);
        assert!(decoded[0].bytes.is_empty());
        assert!(!decoded[0].clauses.is_empty());
        assert!(decoded[0].fault);

        let raw = parse_document(&raw_hex_pack(), text);
        assert_eq!(raw.len(), 1);
        assert_eq!(raw[0].bytes.len(), 1);
        assert!(raw[0].clauses.is_empty());
        assert_eq!(raw[0].bytes[0].hex, "A5 5A 06 1E 00 00 02 22 47");
        assert_eq!(raw[0].bytes[0].text, "A5 5A 06 1E 00 00 02 22 47");
        assert!(!raw[0].bytes[0].text.contains("未知命令"));
        assert!(!raw[0].bytes[0].text.contains("载荷"));
        assert!(!raw[0].fault);
    }

    #[test]
    fn parses_device_status_fault() {
        let pack = length_prefix_pack();
        let text = "2026-11-02 00:00:01.262 Device:/dev/ttyS7 > AA 55 02 1E 1F\n2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 06 1E 00 00 02 22 47\n";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].dir, "tx");
        assert!(!events[0].fault);
        assert_eq!(events[1].dir, "rx");
        assert!(events[1].fault);
        assert!(events[1].title.contains("状态"));
    }

    #[test]
    fn explicit_view_blocks_without_default_clauses() {
        let raw = r#"{
          "id":"view-demo","name":"view-demo","version":"1",
          "line_rules":[{
            "id":"device-arrow",
            "pattern":"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d+)\\s+Device:\\S+\\s+([><])\\s+([0-9A-Fa-f ]+)$",
            "dir_group":2,"dir_map":{">":"tx","<":"rx"},"hex_group":3,"time_group":1
          }],
          "frame":{"tx_header":[170,85],"rx_header":[165,90]},
          "commands":[{
            "cmd":30,"name":"DeviceStatus","title":"查询设备状态",
            "decode":[
              {"type":"uint","id":"st_info1","offset":0,"width":4,"endian":"be","label":"ST_INFO1"},
              {"type":"bits","from":"st_info1","start":0,"width":2,"id":"status","label":"status",
                "map":{"0":"NORMAL","1":"BUSY","2":"ABNORMAL","3":"ERROR"}},
              {"type":"flags","from":"st_info1","bits":[
                {"bit":5,"label":"前门故障","fault":true},
                {"bit":9,"label":"A01 无盖","fault":true,"code":"A01"}
              ]}
            ],
            "view":[
              {"type":"heading"},
              {"type":"status","bind":"status"},
              {"type":"kv","bind":"st_info1"},
              {"type":"flags","bind":"st_info1"},
              {"type":"hex","from_bytes":[0,4],"label":"载荷"}
            ]
          }]
        }"#;
        let pack = CompiledPack::compile(parse_rulepack_json(raw).unwrap()).unwrap();
        let text = "2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 06 1E 00 00 02 22 47\n";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 1);
        assert!(events[0].clauses.is_empty());
        assert!(events[0].bytes.is_empty());
        assert!(!events[0].blocks.is_empty());
        match &events[0].blocks[0] {
            DisplayBlock::Heading { text } => assert!(text.contains("状态")),
            other => panic!("expected heading, got {other:?}"),
        }
        match &events[0].blocks[1] {
            DisplayBlock::Status { value, fault, .. } => {
                assert_eq!(value, "ABNORMAL");
                assert!(*fault);
            }
            other => panic!("expected status, got {other:?}"),
        }
        let flags = events[0]
            .blocks
            .iter()
            .find_map(|b| match b {
                DisplayBlock::Flags { items } => Some(items),
                _ => None,
            })
            .expect("flags block");
        assert!(flags.iter().any(|s| s.contains("前门") || s.contains("无盖")));
        assert!(flags.iter().all(|s| !s.contains("A01")));
    }

    #[test]
    fn unknown_command_keeps_bytes() {
        let pack = length_prefix_pack();
        let text = "2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 03 FE 00 00\n";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 1);
        assert!(events[0].clauses.is_empty());
        assert!(events[0].blocks.is_empty());
        assert!(!events[0].bytes.is_empty());
        assert!(events[0].title.contains("未知命令"));
    }

    #[test]
    fn door_module_group_fault_hides_code() {
        assert_eq!(
            fault_description("ygq=4 → A04 压盖器故障", Some("A04")),
            "压盖器故障"
        );
        assert_eq!(fault_description("E14 前门模组离线", Some("E14")), "前门模组离线");
        assert_eq!(fault_description("A01 无盖", Some("A01")), "无盖");
        assert_eq!(fault_description("E02 落杯器无杯", None), "落杯器无杯");
        assert!(!strip_fault_codes("分组  A04 压盖器故障").contains("A04"));
    }

    #[test]
    fn parses_cn_send_recv() {
        let pack = length_prefix_pack();
        let text = "2026-10-27 00:00:02.706 Coffee-Machine:/dev/ttyS7---发送：AA 55 02 1E 1F\n2026-10-27 00:00:02.726 Coffee-Machine:/dev/ttyS7---接收：A5 5A 06 1E 00 00 03 0F 35\n";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 2);
        assert!(events[1].fault);
    }

    #[test]
    fn skips_heart_lines() {
        let pack = length_prefix_pack();
        let text = "2026-11-02 00:00:28.198 Coffee-Machine:Heart: timestamp='1'\n";
        assert!(parse_document(&pack, text).is_empty());
    }

    #[test]
    fn session_matches_document() {
        let pack = length_prefix_pack();
        let text = "2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 06 1E 00 00 02 22 47\n2026-11-02 00:00:01.300 Device:/dev/ttyS7 > AA 55 02 1E 1F\n2026-11-02 00:00:02.706 Coffee-Machine:/dev/ttyS7---发送：AA 55 02 1E 1F\n2026-11-02 00:00:02.726 Coffee-Machine:/dev/ttyS7---接收：A5 5A 06 1E 00 00 03 0F 35\n";
        let once = parse_document(&pack, text);
        let lines: Vec<&str> = text.split('\n').collect();
        let mid = lines.len() / 2;
        let mut session = ParserSession::new(&pack);
        for (i, line) in lines.iter().enumerate() {
            if i == mid {
                // pause mid-stream then continue — same session
            }
            session.push_line(i + 1, line);
        }
        let streamed = session.finish();
        assert!(!once.is_empty(), "expected events from inline log");
        assert_eq!(once.len(), streamed.len());
        assert_eq!(once[0].title, streamed[0].title);
    }

    #[test]
    fn parse_lines_preserves_line_numbers() {
        let pack = length_prefix_pack();
        let lines = [(
            1283usize,
            "2026-11-02 00:00:01.283 Device:/dev/ttyS7 < A5 5A 06 1E 00 00 02 22 47",
        )];
        let events = parse_lines(&pack, &lines);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].line, 1283);
    }

    #[test]
    fn mdb_ack_and_setup_reply() {
        let pack = mdb_pack();
        let text = "\
2026-08-17 10:41:36.221 Payment:/dev/ttyS9 < 00
2026-08-17 10:41:36.684 Payment:/dev/ttyS9 > 11 00 03 00 00 00
2026-08-17 10:41:37.469 Payment:/dev/ttyS9 < 01 03 11 56 01 02 28 0D A3
";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].title, "ACK");
        assert!(events[1].title.contains("初始化"), "{}", events[1].title);
        assert!(events[2].title.contains("配置"), "{}", events[2].title);
        assert!(!events[2].fault, "checksum should pass");
    }

    #[test]
    fn mdb_setup_reply_bad_checksum_is_fault() {
        let pack = mdb_pack();
        let text = "\
2026-08-17 10:41:36.684 Payment:/dev/ttyS9 > 11 00 03 00 00 00
2026-08-17 10:41:37.469 Payment:/dev/ttyS9 < 01 03 11 56 01 02 28 0D A4
";
        let events = parse_document(&pack, text);
        assert_eq!(events.len(), 2);
        assert!(events[1].title.contains("配置"), "{}", events[1].title);
        assert!(events[1].fault);
    }

    #[test]
    fn mdb_ignores_coffee_device_lines() {
        let pack = mdb_pack();
        let text = "2026-08-17 10:41:36.112 Device:/dev/ttyS7 > AA 55 02 1E 1F\n";
        assert!(parse_document(&pack, text).is_empty());
    }

    #[test]
    fn mdb_pack_loads() {
        let _ = mdb_pack();
    }
}

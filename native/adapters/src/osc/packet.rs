//! OSC 1.0 messages and bundles: what `python-osc` sent and received for VRChat.

use std::fmt;

/// One OSC argument.
#[derive(Debug, Clone, PartialEq)]
pub enum OscArg {
    Int(i32),
    Float(f32),
    String(String),
    Blob(Vec<u8>),
    Bool(bool),
    Nil,
    /// `I`: an impulse (infinitum).
    Impulse,
    Int64(i64),
    Double(f64),
    TimeTag(u64),
    Char(char),
    Rgba(u32),
    Midi([u8; 4]),
    Array(Vec<OscArg>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct OscMessage {
    pub address: String,
    pub args: Vec<OscArg>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseError;

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("malformed OSC packet")
    }
}

impl std::error::Error for ParseError {}

fn pad(out: &mut Vec<u8>) {
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

fn write_string(out: &mut Vec<u8>, text: &str) {
    out.extend_from_slice(text.as_bytes());
    out.push(0);
    pad(out);
}

fn tags(args: &[OscArg], out: &mut String) {
    for arg in args {
        let tag = match arg {
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
            OscArg::String(_) => 's',
            OscArg::Blob(_) => 'b',
            OscArg::Bool(true) => 'T',
            OscArg::Bool(false) => 'F',
            OscArg::Nil => 'N',
            OscArg::Impulse => 'I',
            OscArg::Int64(_) => 'h',
            OscArg::Double(_) => 'd',
            OscArg::TimeTag(_) => 't',
            OscArg::Char(_) => 'c',
            OscArg::Rgba(_) => 'r',
            OscArg::Midi(_) => 'm',
            OscArg::Array(inner) => {
                out.push('[');
                tags(inner, out);
                ']'
            }
        };
        out.push(tag);
    }
}

fn write_args(out: &mut Vec<u8>, args: &[OscArg]) {
    for arg in args {
        match arg {
            OscArg::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::String(v) => write_string(out, v),
            OscArg::Blob(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                out.extend_from_slice(v);
                pad(out);
            }
            OscArg::Int64(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::TimeTag(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::Char(c) => out.extend_from_slice(&(*c as u32).to_be_bytes()),
            OscArg::Rgba(v) => out.extend_from_slice(&v.to_be_bytes()),
            OscArg::Midi(v) => out.extend_from_slice(v),
            OscArg::Array(inner) => write_args(out, inner),
            OscArg::Bool(_) | OscArg::Nil | OscArg::Impulse => {}
        }
    }
}

impl OscMessage {
    pub fn new(address: &str, args: Vec<OscArg>) -> Self {
        Self { address: address.to_string(), args }
    }

    /// The datagram, as python-osc's `OscMessageBuilder` builds it.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        write_string(&mut out, &self.address);
        let mut type_tags = String::from(",");
        tags(&self.args, &mut type_tags);
        write_string(&mut out, &type_tags);
        write_args(&mut out, &self.args);
        out
    }
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ParseError> {
        let end = self.at.checked_add(n).ok_or(ParseError)?;
        let slice = self.data.get(self.at..end).ok_or(ParseError)?;
        self.at = end;
        Ok(slice)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], ParseError> {
        self.take(N)?.try_into().map_err(|_| ParseError)
    }

    fn string(&mut self) -> Result<String, ParseError> {
        let rest = self.data.get(self.at..).ok_or(ParseError)?;
        let end = rest.iter().position(|&b| b == 0).ok_or(ParseError)?;
        let text = std::str::from_utf8(&rest[..end]).map_err(|_| ParseError)?.to_string();
        // The string, its terminator and the padding to a multiple of four.
        let padded = (end + 4) & !3;
        self.take(padded)?;
        Ok(text)
    }
}

fn read_args(reader: &mut Reader<'_>, tags: &mut std::str::Chars<'_>, nested: bool) -> Result<Vec<OscArg>, ParseError> {
    let mut args = Vec::new();
    while let Some(tag) = tags.next() {
        args.push(match tag {
            'i' => OscArg::Int(i32::from_be_bytes(reader.array()?)),
            'f' => OscArg::Float(f32::from_be_bytes(reader.array()?)),
            's' | 'S' => OscArg::String(reader.string()?),
            'b' => {
                let size = i32::from_be_bytes(reader.array()?);
                let size = usize::try_from(size).map_err(|_| ParseError)?;
                let blob = reader.take(size)?.to_vec();
                reader.take((4 - size % 4) % 4)?;
                OscArg::Blob(blob)
            }
            'T' => OscArg::Bool(true),
            'F' => OscArg::Bool(false),
            'N' => OscArg::Nil,
            'I' => OscArg::Impulse,
            'h' => OscArg::Int64(i64::from_be_bytes(reader.array()?)),
            'd' => OscArg::Double(f64::from_be_bytes(reader.array()?)),
            't' => OscArg::TimeTag(u64::from_be_bytes(reader.array()?)),
            'c' => OscArg::Char(char::from_u32(u32::from_be_bytes(reader.array()?)).ok_or(ParseError)?),
            'r' => OscArg::Rgba(u32::from_be_bytes(reader.array()?)),
            'm' => OscArg::Midi(reader.array()?),
            '[' => OscArg::Array(read_args(reader, tags, true)?),
            ']' if nested => return Ok(args),
            _ => return Err(ParseError),
        });
    }
    if nested {
        return Err(ParseError);
    }
    Ok(args)
}

fn decode_message(data: &[u8]) -> Result<OscMessage, ParseError> {
    let mut reader = Reader { data, at: 0 };
    let address = reader.string()?;
    if !address.starts_with('/') {
        return Err(ParseError);
    }
    if reader.at == data.len() {
        // A message without a type tag string has no arguments.
        return Ok(OscMessage { address, args: Vec::new() });
    }
    let type_tags = reader.string()?;
    let Some(type_tags) = type_tags.strip_prefix(',') else { return Err(ParseError) };
    let args = read_args(&mut reader, &mut type_tags.chars(), false)?;
    Ok(OscMessage { address, args })
}

const BUNDLE: &[u8] = b"#bundle\0";

fn collect(data: &[u8], out: &mut Vec<OscMessage>, depth: usize) -> Result<(), ParseError> {
    if depth > 16 {
        return Err(ParseError);
    }
    if data.starts_with(BUNDLE) {
        let mut reader = Reader { data, at: BUNDLE.len() };
        // The time tag is ignored: VRChat state is applied on receipt (python-osc's
        // dispatcher would otherwise sleep until a future time tag).
        reader.take(8)?;
        while reader.at < data.len() {
            let size = i32::from_be_bytes(reader.array()?);
            let size = usize::try_from(size).map_err(|_| ParseError)?;
            collect(reader.take(size)?, out, depth + 1)?;
        }
        Ok(())
    } else if data.first() == Some(&b'/') {
        out.push(decode_message(data)?);
        Ok(())
    } else {
        Err(ParseError)
    }
}

/// Every message of a datagram, including bundle contents in order. A malformed
/// datagram yields an error and none of its messages.
pub fn decode_packet(data: &[u8]) -> Result<Vec<OscMessage>, ParseError> {
    let mut out = Vec::new();
    collect(data, &mut out, 0)?;
    Ok(out)
}

/// Whether an OSC address pattern (`?`, `*`, `[...]`, `{a,b}`) matches `address`.
pub fn pattern_matches(pattern: &str, address: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let address: Vec<char> = address.chars().collect();
    matches(&pattern, &address)
}

fn matches(pattern: &[char], address: &[char]) -> bool {
    let Some((&first, rest)) = pattern.split_first() else { return address.is_empty() };
    match first {
        '*' => {
            (0..=address.len()).take_while(|&n| n == 0 || address[n - 1] != '/').any(|n| matches(rest, &address[n..]))
        }
        '?' => address.first().is_some_and(|&c| c != '/') && matches(rest, &address[1..]),
        '[' => {
            let Some(close) = rest.iter().position(|&c| c == ']') else {
                return address.first() == Some(&'[') && matches(rest, &address[1..]);
            };
            let Some(&c) = address.first() else { return false };
            let mut set = &rest[..close];
            let negate = set.first() == Some(&'!');
            if negate {
                set = &set[1..];
            }
            let mut found = false;
            let mut i = 0;
            while i < set.len() {
                if i + 2 < set.len() && set[i + 1] == '-' {
                    found |= set[i] <= c && c <= set[i + 2];
                    i += 3;
                } else {
                    found |= set[i] == c;
                    i += 1;
                }
            }
            found != negate && c != '/' && matches(&rest[close + 1..], &address[1..])
        }
        '{' => {
            let Some(close) = rest.iter().position(|&c| c == '}') else {
                return address.first() == Some(&'{') && matches(rest, &address[1..]);
            };
            let after = &rest[close + 1..];
            rest[..close].split(|&c| c == ',').any(|choice| {
                address.len() >= choice.len()
                    && address[..choice.len()] == *choice
                    && matches(after, &address[choice.len()..])
            })
        }
        c => address.first() == Some(&c) && matches(rest, &address[1..]),
    }
}

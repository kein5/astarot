//! Taking named files out of a pinned archive: a zip (a wheel, a NuGet package of ONNX
//! Runtime) or a gzip tar (ONNX Runtime's GitHub archive for Linux until 2026-11-18), as
//! `unpack_members` in `runtime_setup.py` did.
//!
//! The archive's hash is checked before this runs. A name that is missing, a link, a folder,
//! an encrypted entry, or a file name that could leave the target refuses the whole archive.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Why an archive was refused (`source_entry_type`, `source_path_unsafe`), or an I/O error.
#[derive(Debug)]
pub enum ArchiveError {
    Refused(&'static str),
    Io(io::Error),
}

impl From<io::Error> for ArchiveError {
    fn from(error: io::Error) -> Self {
        ArchiveError::Io(error)
    }
}

type Result<T> = std::result::Result<T, ArchiveError>;

const ENTRY_TYPE: ArchiveError = ArchiveError::Refused("source_entry_type");

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'+' | b'-'))
}

/// Copy `reader` to `target/name` through `name.part`.
fn write_member(reader: &mut dyn Read, target: &Path, name: &str) -> Result<()> {
    if !safe_name(name) {
        return Err(ArchiveError::Refused("source_path_unsafe"));
    }
    let part = target.join(format!("{name}.part"));
    {
        let mut writer = File::create(&part)?;
        io::copy(reader, &mut writer)?;
        writer.flush()?;
    }
    fs::rename(&part, target.join(name))?;
    Ok(())
}

/// Take `members` (`(path in the archive, file name in target)`) out of `archive` into `target`.
pub fn unpack_members(archive: &Path, members: &[(String, String)], target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    let mut file = File::open(archive)?;
    let mut magic = [0u8; 4];
    let read = file.read(&mut magic)?;
    file.seek(SeekFrom::Start(0))?;
    if read == 4 && &magic == b"PK\x03\x04" {
        let entries = zip_entries(&mut file)?;
        for (member, name) in members {
            let entry = entries.iter().find(|entry| &entry.name == member).ok_or(ENTRY_TYPE)?;
            let mut reader = zip_reader(&mut file, entry)?;
            write_member(&mut reader, target, name)?;
            reader.finish()?;
        }
        return Ok(());
    }
    for (member, name) in members {
        // A tar has no index: read it once per member, as Python's getmember did.
        let file = File::open(archive)?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        let mut found = false;
        for entry in tar.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.to_string_lossy().replace('\\', "/");
            if path.trim_start_matches("./") != member.as_str() {
                continue;
            }
            if entry.header().entry_type() != tar::EntryType::Regular {
                return Err(ENTRY_TYPE);
            }
            write_member(&mut entry, target, name)?;
            found = true;
            break;
        }
        if !found {
            return Err(ENTRY_TYPE);
        }
    }
    Ok(())
}

struct ZipEntry {
    name: String,
    method: u16,
    flags: u16,
    crc: u32,
    compressed: u64,
    size: u64,
    offset: u64,
    external: u32,
    made_by: u16,
}

fn u16_at(data: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([data[at], data[at + 1]])
}

fn u32_at(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().expect("four bytes"))
}

fn u64_at(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(data[at..at + 8].try_into().expect("eight bytes"))
}

fn broken() -> ArchiveError {
    ArchiveError::Io(io::Error::new(io::ErrorKind::InvalidData, "zip"))
}

/// The central directory, with ZIP64 sizes and offsets where an entry has them.
fn zip_entries(file: &mut File) -> Result<Vec<ZipEntry>> {
    let length = file.seek(SeekFrom::End(0))?;
    let tail = length.min(65_557 + 20);
    file.seek(SeekFrom::Start(length - tail))?;
    let mut end = vec![0u8; tail as usize];
    file.read_exact(&mut end)?;
    let at = (0..end.len().saturating_sub(21)).rev().find(|&i| end[i..i + 4] == *b"PK\x05\x06").ok_or_else(broken)?;
    let mut count = u64::from(u16_at(&end, at + 10));
    let mut directory_size = u64::from(u32_at(&end, at + 12));
    let mut directory_offset = u64::from(u32_at(&end, at + 16));
    if at >= 20 && end[at - 20..at - 16] == *b"PK\x06\x07" {
        let record = u64_at(&end, at - 20 + 8);
        file.seek(SeekFrom::Start(record))?;
        let mut zip64 = [0u8; 56];
        file.read_exact(&mut zip64)?;
        if zip64[..4] != *b"PK\x06\x06" {
            return Err(broken());
        }
        count = u64_at(&zip64, 32);
        directory_size = u64_at(&zip64, 40);
        directory_offset = u64_at(&zip64, 48);
    }
    if directory_size > 64 * 1024 * 1024 {
        return Err(broken());
    }
    file.seek(SeekFrom::Start(directory_offset))?;
    let mut directory = vec![0u8; directory_size as usize];
    file.read_exact(&mut directory)?;
    let mut entries = Vec::new();
    let mut at = 0;
    for _ in 0..count {
        if at + 46 > directory.len() || directory[at..at + 4] != *b"PK\x01\x02" {
            return Err(broken());
        }
        let name_length = u16_at(&directory, at + 28) as usize;
        let extra_length = u16_at(&directory, at + 30) as usize;
        let comment_length = u16_at(&directory, at + 32) as usize;
        let name_end = at + 46 + name_length;
        if name_end + extra_length > directory.len() {
            return Err(broken());
        }
        let mut entry = ZipEntry {
            name: String::from_utf8_lossy(&directory[at + 46..name_end]).into_owned(),
            made_by: u16_at(&directory, at + 4),
            flags: u16_at(&directory, at + 8),
            method: u16_at(&directory, at + 10),
            crc: u32_at(&directory, at + 16),
            compressed: u64::from(u32_at(&directory, at + 20)),
            size: u64::from(u32_at(&directory, at + 24)),
            external: u32_at(&directory, at + 38),
            offset: u64::from(u32_at(&directory, at + 42)),
        };
        // ZIP64: the fields that were 0xFFFFFFFF follow in the extra field, in this order.
        let mut extra = name_end;
        while extra + 4 <= name_end + extra_length {
            let id = u16_at(&directory, extra);
            let size = u16_at(&directory, extra + 2) as usize;
            if id == 1 {
                let mut field = extra + 4;
                for value in [&mut entry.size, &mut entry.compressed, &mut entry.offset] {
                    if *value == u64::from(u32::MAX) && field + 8 <= extra + 4 + size {
                        *value = u64_at(&directory, field);
                        field += 8;
                    }
                }
            }
            extra += 4 + size;
        }
        entries.push(entry);
        at = name_end + extra_length + comment_length;
    }
    Ok(entries)
}

/// The entry's data, checked against its size and CRC when read to the end.
struct ZipReader<'a> {
    inner: Box<dyn Read + 'a>,
    crc: crc32fast::Hasher,
    expected_crc: u32,
    expected_size: u64,
    read: u64,
}

impl Read for ZipReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.crc.update(&buffer[..count]);
        self.read += count as u64;
        if self.read > self.expected_size {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "zip size"));
        }
        Ok(count)
    }
}

impl ZipReader<'_> {
    fn finish(self) -> Result<()> {
        if self.read != self.expected_size || self.crc.finalize() != self.expected_crc {
            return Err(broken());
        }
        Ok(())
    }
}

fn zip_reader<'a>(file: &'a mut File, entry: &ZipEntry) -> Result<ZipReader<'a>> {
    // Unix file type in the high bits when the archive was made on Unix (3): regular or none.
    let kind = if entry.made_by >> 8 == 3 { (entry.external >> 16) & 0o170000 } else { 0 };
    if entry.name.ends_with('/') || !(kind == 0 || kind == 0o100000) || entry.flags & 1 != 0 {
        return Err(ENTRY_TYPE);
    }
    file.seek(SeekFrom::Start(entry.offset))?;
    let mut local = [0u8; 30];
    file.read_exact(&mut local)?;
    if local[..4] != *b"PK\x03\x04" {
        return Err(broken());
    }
    let skip = u64::from(u16_at(&local, 26)) + u64::from(u16_at(&local, 28));
    file.seek(SeekFrom::Current(skip as i64))?;
    let data = file.take(entry.compressed);
    let inner: Box<dyn Read + 'a> = match entry.method {
        0 => Box::new(data),
        8 => Box::new(flate2::read::DeflateDecoder::new(data)),
        _ => return Err(ENTRY_TYPE),
    };
    Ok(ZipReader { inner, crc: crc32fast::Hasher::new(), expected_crc: entry.crc, expected_size: entry.size, read: 0 })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use flate2::write::DeflateEncoder;
    use flate2::Compression;

    /// A zip with the given `(name, data, deflate)` entries.
    pub(crate) fn zip(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data, deflate) in entries {
            let body = if *deflate {
                let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
                encoder.write_all(data).unwrap();
                encoder.finish().unwrap()
            } else {
                data.to_vec()
            };
            let crc = crc32fast::hash(data);
            let method: u16 = if *deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            out.extend(b"PK\x03\x04");
            out.extend(20u16.to_le_bytes());
            out.extend(0u16.to_le_bytes());
            out.extend(method.to_le_bytes());
            out.extend([0u8; 4]);
            out.extend(crc.to_le_bytes());
            out.extend((body.len() as u32).to_le_bytes());
            out.extend((data.len() as u32).to_le_bytes());
            out.extend((name.len() as u16).to_le_bytes());
            out.extend(0u16.to_le_bytes());
            out.extend(name.as_bytes());
            out.extend(&body);
            central.extend(b"PK\x01\x02");
            central.extend(20u16.to_le_bytes());
            central.extend(20u16.to_le_bytes());
            central.extend(0u16.to_le_bytes());
            central.extend(method.to_le_bytes());
            central.extend([0u8; 4]);
            central.extend(crc.to_le_bytes());
            central.extend((body.len() as u32).to_le_bytes());
            central.extend((data.len() as u32).to_le_bytes());
            central.extend((name.len() as u16).to_le_bytes());
            central.extend([0u8; 8]);
            central.extend(0u32.to_le_bytes());
            central.extend(offset.to_le_bytes());
            central.extend(name.as_bytes());
        }
        let start = out.len() as u32;
        out.extend(&central);
        out.extend(b"PK\x05\x06");
        out.extend([0u8; 4]);
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((central.len() as u32).to_le_bytes());
        out.extend(start.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out
    }

    #[test]
    fn named_files_come_out_of_a_zip_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.whl");
        std::fs::write(&archive, zip(&[("nvidia/cu13/lib/libx.so", b"library bytes", true), ("other.txt", b"x", false)])).unwrap();
        let target = dir.path().join("lib");
        unpack_members(&archive, &[("nvidia/cu13/lib/libx.so".into(), "libx.so".into())], &target).unwrap();
        assert_eq!(std::fs::read(target.join("libx.so")).unwrap(), b"library bytes");
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 1);
        assert!(matches!(unpack_members(&archive, &[("missing".into(), "m".into())], &target), Err(ArchiveError::Refused("source_entry_type"))));
        assert!(matches!(unpack_members(&archive, &[("other.txt".into(), "../escape".into())], &target), Err(ArchiveError::Refused("source_path_unsafe"))));
    }

    #[test]
    fn named_files_come_out_of_a_gzip_tar() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.tgz");
        {
            let encoder = flate2::write::GzEncoder::new(File::create(&archive).unwrap(), Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_size(5);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, "ort/lib/libonnxruntime.so.1.31.0", &b"hello"[..]).unwrap();
            let mut link = tar::Header::new_gnu();
            link.set_entry_type(tar::EntryType::Symlink);
            link.set_size(0);
            link.set_cksum();
            builder.append_link(&mut link, "ort/lib/link.so", "libonnxruntime.so.1.31.0").unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }
        let target = dir.path().join("lib");
        unpack_members(&archive, &[("ort/lib/libonnxruntime.so.1.31.0".into(), "libonnxruntime.so".into())], &target).unwrap();
        assert_eq!(std::fs::read(target.join("libonnxruntime.so")).unwrap(), b"hello");
        assert!(matches!(unpack_members(&archive, &[("ort/lib/link.so".into(), "link.so".into())], &target), Err(ArchiveError::Refused("source_entry_type"))));
    }
}

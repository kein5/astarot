//! Windows: the adapters from DXGI, their usage from the performance counters (PDH).

use super::parse::{self, Luid};
use super::{AppUsage, FAILED, Gpu, ProcessRow, app_processes};
use std::collections::HashMap;

use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
use windows::Win32::System::Performance::{
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA, PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
    PdhGetFormattedCounterArrayW, PdhOpenQueryW,
};
use windows::core::{PCWSTR, w};

struct Adapter {
    luid: Luid,
    name: String,
    total: u64,
}

/// The hardware adapters, without Microsoft's software renderer.
fn adapters() -> Result<Vec<Adapter>, &'static str> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.map_err(|_| FAILED)?;
    let mut found = Vec::new();
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else { break };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
        if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
            continue;
        }
        let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..end]).chars().filter(|c| !c.is_control()).take(128).collect::<String>();
        let luid = (desc.AdapterLuid.HighPart as u32, desc.AdapterLuid.LowPart);
        // One adapter may be listed once per output it drives.
        if found.iter().any(|a: &Adapter| a.luid == luid) {
            continue;
        }
        found.push(Adapter { luid, name: name.trim().to_owned(), total: desc.DedicatedVideoMemory as u64 });
    }
    Ok(found)
}

/// Every process with its parent and executable.
fn processes() -> Vec<ProcessRow> {
    let mut rows = Vec::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else { return rows };
    let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while more {
        let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        rows.push(ProcessRow { pid: entry.th32ProcessID, parent: entry.th32ParentProcessID, executable: String::from_utf16_lossy(&entry.szExeFile[..end]) });
        more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    rows
}

/// A performance counter query, closed when dropped.
struct Query(PDH_HQUERY);

impl Drop for Query {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.0);
        }
    }
}

/// Each instance of a counter with its value.
fn values(counter: PDH_HCOUNTER) -> Vec<(String, u64)> {
    let (mut bytes, mut count) = (0u32, 0u32);
    let status = unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, &mut bytes, &mut count, None) };
    if status != PDH_MORE_DATA || bytes == 0 {
        return Vec::new();
    }
    // u64 for the alignment of the items; the names follow them in the same buffer.
    let mut buffer = vec![0u64; (bytes as usize).div_ceil(8)];
    let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
    let status = unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_LARGE, &mut bytes, &mut count, Some(items)) };
    if status != ERROR_SUCCESS.0 {
        return Vec::new();
    }
    let items = unsafe { std::slice::from_raw_parts(items, count as usize) };
    items
        .iter()
        .filter(|item| item.FmtValue.CStatus == ERROR_SUCCESS.0)
        .filter_map(|item| {
            let name = unsafe { item.szName.to_string() }.ok()?;
            let value = unsafe { item.FmtValue.Anonymous.largeValue };
            Some((name, u64::try_from(value).ok()?))
        })
        .collect()
}

fn counter(query: &Query, path: PCWSTR) -> Result<PDH_HCOUNTER, &'static str> {
    let mut counter = PDH_HCOUNTER::default();
    let status = unsafe { PdhAddEnglishCounterW(query.0, path, 0, &mut counter) };
    if status == ERROR_SUCCESS.0 { Ok(counter) } else { Err(FAILED) }
}

pub(super) fn read(root: u32) -> Result<Vec<Gpu>, &'static str> {
    let adapters = adapters()?;
    let mut handle = PDH_HQUERY::default();
    if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut handle) } != ERROR_SUCCESS.0 {
        return Err(FAILED);
    }
    let query = Query(handle);
    let adapter_counter = counter(&query, w!(r"\GPU Adapter Memory(*)\Dedicated Usage"))?;
    let process_counter = counter(&query, w!(r"\GPU Process Memory(*)\Dedicated Usage"))?;
    let shared_counter = counter(&query, w!(r"\GPU Process Memory(*)\Shared Usage"))?;
    // Memory in use is a plain value: one collection is enough (a rate would need two).
    if unsafe { PdhCollectQueryData(query.0) } != ERROR_SUCCESS.0 {
        return Err(FAILED);
    }
    let mut used: HashMap<Luid, u64> = HashMap::new();
    for (instance, bytes) in values(adapter_counter) {
        if let Some(luid) = parse::pdh_adapter(&instance) {
            let total = used.entry(luid).or_default();
            *total = total.saturating_add(bytes);
        }
    }
    let app = app_processes(&processes(), root);
    let mut usage: HashMap<Luid, AppUsage> = HashMap::new();
    for (instance, bytes) in values(process_counter) {
        if let Some((pid, luid)) = parse::pdh_process(&instance)
            && let Some(part) = app.get(&pid)
        {
            usage.entry(luid).or_default().add(*part, bytes);
        }
    }
    let mut shared: HashMap<Luid, u64> = HashMap::new();
    for (instance, bytes) in values(shared_counter) {
        if let Some((pid, luid)) = parse::pdh_process(&instance)
            && app.contains_key(&pid)
        {
            let total = shared.entry(luid).or_default();
            *total = total.saturating_add(bytes);
        }
    }
    drop(query);
    Ok(adapters
        .into_iter()
        .map(|adapter| Gpu {
            name: adapter.name,
            total: (adapter.total > 0).then_some(adapter.total),
            used: used.get(&adapter.luid).copied(),
            app: usage.remove(&adapter.luid).unwrap_or_default(),
            app_shared: Some(shared.get(&adapter.luid).copied().unwrap_or(0)),
        })
        .collect())
}

//! The Windows Credential Manager: generic credentials of the signed-in user, kept on this PC
//! only (`CRED_PERSIST_LOCAL_MACHINE`, never the roaming profile). Each entry is one credential
//! named `ASTAROT/<scope>/<entry>` (0.6.0 used `VRCT-VOX/<scope>/<entry>`, read through
//! [`CredentialManager::older`]), its value the key's UTF-8 bytes. The user can see and remove
//! them under "Windows Credentials" in the Credential Manager.

use super::{StoreError, Vault};
use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, FILETIME, GetLastError};
use windows_sys::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
};

/// The largest value a credential holds (`CRED_MAX_CREDENTIAL_BLOB_SIZE`).
const MAX_VALUE: usize = 5 * 512;
/// The Credential Manager under one prefix. The names start with the internal identifier, not
/// the display name (ADR-013 4.3).
pub struct CredentialManager {
    prefix: &'static str,
}

impl CredentialManager {
    /// The names this build writes.
    pub fn new() -> Self {
        Self { prefix: app_identity::credentials::WINDOWS_PREFIX.current() }
    }

    /// The names 0.6.0 wrote, read until the keys move (ADR-014, 2.9).
    pub fn older() -> Self {
        Self { prefix: app_identity::credentials::WINDOWS_PREFIX.legacy }
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The credential's name.
pub(super) fn target(prefix: &str, scope: &str, entry: &str) -> String {
    format!("{prefix}/{scope}/{entry}")
}

/// What a failure means. No logon session (a service without a loaded profile) and the system
/// being busy are passing; anything else is `otherwise`.
fn classify(error: u32, otherwise: StoreError) -> StoreError {
    const ERROR_NOT_ENOUGH_MEMORY: u32 = 8;
    const ERROR_OUTOFMEMORY: u32 = 14;
    const ERROR_BUSY: u32 = 170;
    const ERROR_NO_SUCH_LOGON_SESSION: u32 = 1312;
    const ERROR_NO_SYSTEM_RESOURCES: u32 = 1450;
    const ERROR_TIMEOUT: u32 = 1460;
    const RPC_S_SERVER_UNAVAILABLE: u32 = 1722;
    const RPC_S_SERVER_TOO_BUSY: u32 = 1723;
    match error {
        ERROR_NO_SUCH_LOGON_SESSION
        | ERROR_NOT_ENOUGH_MEMORY
        | ERROR_OUTOFMEMORY
        | ERROR_BUSY
        | ERROR_NO_SYSTEM_RESOURCES
        | ERROR_TIMEOUT
        | RPC_S_SERVER_UNAVAILABLE
        | RPC_S_SERVER_TOO_BUSY => StoreError::Unavailable,
        _ => otherwise,
    }
}

impl Vault for CredentialManager {
    fn label(&self) -> &'static str {
        "credential_manager"
    }

    fn fetch(&self, scope: &str, entry: &str) -> Result<Option<String>, StoreError> {
        let name = wide(&target(self.prefix, scope, entry));
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        let ok = unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            return if error == ERROR_NOT_FOUND { Ok(None) } else { Err(classify(error, StoreError::Unreadable)) };
        }
        let bytes = unsafe {
            let found = &*credential;
            let bytes = if found.CredentialBlob.is_null() {
                Vec::new()
            } else {
                std::slice::from_raw_parts(found.CredentialBlob, found.CredentialBlobSize as usize).to_vec()
            };
            CredFree(credential as *const _);
            bytes
        };
        String::from_utf8(bytes).map(Some).map_err(|_| StoreError::Unreadable)
    }

    fn put(&self, scope: &str, entry: &str, value: &str) -> Result<(), StoreError> {
        if value.len() > MAX_VALUE {
            return Err(StoreError::WriteFailed);
        }
        let mut name = wide(&target(self.prefix, scope, entry));
        let mut user = wide(self.prefix);
        let mut blob = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            Comment: std::ptr::null_mut(),
            LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: if blob.is_empty() { std::ptr::null_mut() } else { blob.as_mut_ptr() },
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: user.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        // The copy of the key in this process's memory is cleared, as far as it is ours.
        blob.iter_mut().for_each(|b| *b = 0);
        if ok == 0 {
            return Err(classify(unsafe { GetLastError() }, StoreError::WriteFailed));
        }
        Ok(())
    }

    fn remove(&self, scope: &str, entry: &str) -> Result<(), StoreError> {
        let name = wide(&target(self.prefix, scope, entry));
        let ok = unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error != ERROR_NOT_FOUND {
                return Err(classify(error, StoreError::WriteFailed));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_failures() {
        let (current, older) = (CredentialManager::new(), CredentialManager::older());
        assert_eq!(target(current.prefix, "0123456789abcdef", "AUTH_KEYS/DeepL_API"), "ASTAROT/0123456789abcdef/AUTH_KEYS/DeepL_API");
        // Where 0.6.0 kept them.
        assert_eq!(target(older.prefix, "0123456789abcdef", "AUTH_KEYS/DeepL_API"), "VRCT-VOX/0123456789abcdef/AUTH_KEYS/DeepL_API");
        assert_eq!(classify(1312, StoreError::Unreadable), StoreError::Unavailable);
        assert_eq!(classify(5, StoreError::Unreadable), StoreError::Unreadable);
        assert_eq!(classify(5, StoreError::WriteFailed), StoreError::WriteFailed);
    }

    /// The real Credential Manager of the signed-in user. It writes one credential under a scope
    /// of its own and removes it again. Run with `cargo test -- --ignored credential_manager`.
    #[test]
    #[ignore = "uses the signed-in user's Credential Manager"]
    fn credential_manager_keeps_reads_and_removes_a_key() {
        let scope = format!("test{}", &super::super::new_store_id()[..12]);
        let store = CredentialManager::new();
        let entry = "AUTH_KEYS/DeepL_API";
        let value = "test-value-not-a-real-key";
        assert_eq!(store.fetch(&scope, entry), Ok(None));
        store.put(&scope, entry, value).unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(Some(value.to_string())));
        store.put(&scope, entry, "changed").unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(Some("changed".to_string())));
        store.remove(&scope, entry).unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(None));
        store.remove(&scope, entry).unwrap();
        assert_eq!(store.put(&scope, entry, &"x".repeat(MAX_VALUE + 1)), Err(StoreError::WriteFailed));
        assert_eq!(store.fetch(&scope, entry), Ok(None));
    }
}

//! The app's store: the OS credential store, with `secrets.json` as the place keys move from
//! (ADR-013, issue #575).
//!
//! - A key is kept in the OS store under this settings folder's id, which `secrets.json` holds
//!   (made when the first key is kept). Without an id there is nothing of this folder's in the OS
//!   store, and it is not asked at all.
//! - Reading takes the OS store's key. A key only `secrets.json` holds (written by 0.5) is used
//!   from there and named by [`SecretStore::take_unmoved`]; writing it moves it. When the OS store
//!   cannot answer (not there, locked, too slow), a key `secrets.json` still holds is used.
//! - Writing puts the key in the OS store and reads it back; only a key read back is removed
//!   from `secrets.json`. A failure changes nothing in `secrets.json`, and no key is ever written
//!   to `secrets.json` again: the file only loses keys.
//! - Deleting removes the key from `secrets.json` first (so a plain-text copy goes even when the
//!   OS store cannot answer), then from the OS store.

use super::{FileStore, ReadFailure, SecretStore, StoreError, Vault};
use std::sync::{Arc, Mutex};

pub struct SystemStore {
    file: FileStore,
    vault: Arc<dyn Vault>,
    unmoved: Mutex<Vec<String>>,
}

impl SystemStore {
    pub fn new(file: FileStore, vault: Arc<dyn Vault>) -> Self {
        Self { file, vault, unmoved: Mutex::new(Vec::new()) }
    }

    /// `secrets.json`, the place keys move from.
    pub fn file(&self) -> &FileStore {
        &self.file
    }

    /// This settings folder's id in the OS store, once a key was kept there.
    pub fn scope(&self) -> Option<String> {
        self.file.store_id().ok().flatten()
    }

    /// A key read from `secrets.json`: used, and named as one to move.
    fn from_file(&self, entry: &str, value: String) -> Result<Option<String>, StoreError> {
        let mut unmoved = self.unmoved.lock().unwrap();
        if !unmoved.iter().any(|e| e == entry) {
            unmoved.push(entry.to_string());
        }
        Ok(Some(value))
    }
}

impl SecretStore for SystemStore {
    fn kind(&self) -> &'static str {
        self.vault.label()
    }

    fn read(&self, entry: &str) -> Result<Option<String>, StoreError> {
        let scope = match self.file.store_id() {
            Ok(scope) => scope,
            // The id may be there; without it, keys in the OS store cannot be told apart.
            Err(ReadFailure::Io) => return Err(StoreError::Unreadable),
            Err(ReadFailure::Undecodable) => None,
        };
        let Some(scope) = scope else {
            return match self.file.lookup(entry) {
                Ok(Some(value)) => self.from_file(entry, value),
                Ok(None) => Ok(None),
                Err(_) => Err(StoreError::Unreadable),
            };
        };
        match self.vault.fetch(&scope, entry) {
            Ok(Some(value)) => {
                // A copy a move could not remove from the file goes now. A different value is
                // left alone: which one is meant cannot be told, and the OS store's is used.
                if matches!(self.file.lookup(entry), Ok(Some(ref old)) if *old == value) {
                    let _ = self.file.delete(entry);
                }
                Ok(Some(value))
            }
            Ok(None) => match self.file.lookup(entry) {
                Ok(Some(value)) => self.from_file(entry, value),
                Ok(None) => Ok(None),
                Err(_) => Err(StoreError::Unreadable),
            },
            // The OS store cannot answer now: a key the file still holds is used meanwhile.
            Err(error) => match self.file.lookup(entry) {
                Ok(Some(value)) => self.from_file(entry, value),
                _ => Err(error),
            },
        }
    }

    fn write(&self, entry: &str, value: &str) -> Result<(), StoreError> {
        let scope = self.file.ensure_store_id()?;
        self.vault.put(&scope, entry, value)?;
        match self.vault.fetch(&scope, entry)? {
            Some(read) if read == value => {}
            _ => return Err(StoreError::WriteFailed),
        }
        // Kept in the OS store: the file's copy (the same key or an older one) goes. A file whose
        // entries cannot be decrypted is moved aside, its id kept, as a write did before. If this
        // fails the key is still safe, and the next start removes the copy.
        match self.file.lookup(entry) {
            Ok(Some(_)) | Err(ReadFailure::Undecodable) => {
                let _ = self.file.delete(entry);
            }
            Ok(None) | Err(ReadFailure::Io) => {}
        }
        self.unmoved.lock().unwrap().retain(|e| e != entry);
        Ok(())
    }

    fn delete(&self, entry: &str) -> Result<(), StoreError> {
        let from_file = match self.file.lookup(entry) {
            Ok(Some(_)) => self.file.delete(entry),
            // Nothing there, or nothing that can ever be read back.
            Ok(None) | Err(ReadFailure::Undecodable) => Ok(()),
            Err(ReadFailure::Io) => Err(StoreError::WriteFailed),
        };
        let from_vault = match self.file.store_id() {
            Ok(Some(scope)) => self.vault.remove(&scope, entry),
            // No id that can be read: nothing of this folder's can be found in the OS store.
            Ok(None) | Err(ReadFailure::Undecodable) => Ok(()),
            Err(ReadFailure::Io) => Err(StoreError::WriteFailed),
        };
        if from_file.is_ok() && from_vault.is_ok() {
            self.unmoved.lock().unwrap().retain(|e| e != entry);
        }
        from_file.and(from_vault)
    }

    fn take_unmoved(&self) -> Vec<String> {
        std::mem::take(&mut *self.unmoved.lock().unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::super::{FILE_NAME, Faults, MemoryStore, write_verified};
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123:fx";
    const OTHER: &str = "sk-another-provider-key";

    struct Folder {
        dir: PathBuf,
    }

    impl Folder {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("vrct-system-store-test-{}", super::super::new_store_id()));
            fs::create_dir_all(&dir).unwrap();
            Folder { dir }
        }

        fn path(&self) -> PathBuf {
            self.dir.join(FILE_NAME)
        }

        fn store(&self, vault: &Arc<MemoryStore>) -> SystemStore {
            SystemStore::new(FileStore::new(self.path()), Arc::clone(vault) as Arc<dyn Vault>)
        }

        /// `secrets.json` as 0.5 wrote it.
        fn old_file(&self, entries: &[(&str, &str)]) {
            let file = FileStore::new(self.path());
            for (entry, value) in entries {
                file.write(entry, value).unwrap();
            }
        }

        fn file_entry(&self, entry: &str) -> Option<String> {
            FileStore::new(self.path()).read(entry).unwrap()
        }

        fn raw(&self) -> String {
            fs::read_to_string(self.path()).unwrap_or_default()
        }

        fn aside(&self) -> usize {
            fs::read_dir(&self.dir).unwrap().filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| n.contains(".unreadable-")).count()
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn a_fresh_folder_asks_the_os_store_nothing_until_a_key_is_kept() {
        let folder = Folder::new();
        let vault = MemoryStore::new();
        // A store that cannot answer shows that it is not asked.
        vault.set_faults(Faults { unavailable: true, ..Faults::default() });
        let store = folder.store(&vault);
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(None));
        assert_eq!(store.delete("AUTH_KEYS/DeepL_API"), Ok(()));
        assert!(!folder.path().exists(), "nothing written");

        vault.set_faults(Faults::default());
        write_verified(&store, "AUTH_KEYS/DeepL_API", KEY).unwrap();
        let scope = store.scope().expect("an id once a key is kept");
        assert_eq!(vault.get(&MemoryStore::scoped(&scope, "AUTH_KEYS/DeepL_API")).as_deref(), Some(KEY));
        assert!(!folder.raw().contains(KEY), "the key is not in the file");
        assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API"), None);
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
    }

    #[test]
    fn two_settings_folders_do_not_share_keys() {
        let (one, two) = (Folder::new(), Folder::new());
        let vault = MemoryStore::new();
        let (first, second) = (one.store(&vault), two.store(&vault));
        first.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
        second.write("AUTH_KEYS/DeepL_API", OTHER).unwrap();
        assert_ne!(first.scope(), second.scope());
        assert_eq!(first.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
        assert_eq!(second.read("AUTH_KEYS/DeepL_API"), Ok(Some(OTHER.into())));
        second.delete("AUTH_KEYS/DeepL_API").unwrap();
        assert_eq!(first.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())), "the other folder's key stays");
    }

    #[test]
    fn a_key_only_the_file_holds_is_used_and_moves_when_written() {
        let folder = Folder::new();
        folder.old_file(&[("AUTH_KEYS/DeepL_API", KEY), ("AUTH_KEYS/OpenAI_API", OTHER)]);
        let vault = MemoryStore::new();
        let store = folder.store(&vault);
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
        assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Ok(Some(OTHER.into())));
        assert_eq!(store.read("AUTH_KEYS/Gemini_API"), Ok(None));
        assert_eq!(store.take_unmoved(), ["AUTH_KEYS/DeepL_API", "AUTH_KEYS/OpenAI_API"]);
        assert!(store.take_unmoved().is_empty(), "named once");
        assert!(vault.snapshot().is_empty(), "reading moves nothing");

        write_verified(&store, "AUTH_KEYS/DeepL_API", KEY).unwrap();
        assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API"), None, "removed once read back");
        assert_eq!(folder.file_entry("AUTH_KEYS/OpenAI_API").as_deref(), Some(OTHER), "the others wait for their turn");
        let scope = store.scope().unwrap();
        assert_eq!(vault.get(&MemoryStore::scoped(&scope, "AUTH_KEYS/DeepL_API")).as_deref(), Some(KEY));
    }

    #[test]
    fn a_move_that_is_not_read_back_leaves_the_key_in_the_file() {
        for faults in [
            Faults { write: true, ..Faults::default() },
            Faults { lose_writes: true, ..Faults::default() },
            Faults { unavailable: true, ..Faults::default() },
            Faults { locked: true, ..Faults::default() },
        ] {
            let folder = Folder::new();
            folder.old_file(&[("AUTH_KEYS/DeepL_API", KEY)]);
            let vault = MemoryStore::new();
            vault.set_faults(faults);
            let store = folder.store(&vault);
            assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())), "{faults:?}");
            assert!(write_verified(&store, "AUTH_KEYS/DeepL_API", KEY).is_err(), "{faults:?}");
            assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API").as_deref(), Some(KEY), "{faults:?}: kept where it was");
            // Once the store answers, the move goes through.
            vault.set_faults(Faults::default());
            write_verified(&store, "AUTH_KEYS/DeepL_API", KEY).unwrap();
            assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API"), None, "{faults:?}");
        }
    }

    #[test]
    fn a_new_key_is_never_written_to_the_file_when_the_os_store_fails() {
        let folder = Folder::new();
        let vault = MemoryStore::new();
        vault.set_faults(Faults { unavailable: true, ..Faults::default() });
        let store = folder.store(&vault);
        assert_eq!(store.write("AUTH_KEYS/DeepL_API", KEY), Err(StoreError::Unavailable));
        assert!(!folder.raw().contains(KEY), "no plain-text fallback");
        assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API"), None);
    }

    #[test]
    fn a_store_that_cannot_answer_changes_nothing_and_the_files_key_is_used() {
        for faults in [Faults { unavailable: true, ..Faults::default() }, Faults { locked: true, ..Faults::default() }] {
            let folder = Folder::new();
            let vault = MemoryStore::new();
            let store = folder.store(&vault);
            store.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
            let scope = store.scope().unwrap();
            // A key 0.5 left in the file next to the moved one.
            FileStore::new(folder.path()).write("AUTH_KEYS/OpenAI_API", OTHER).unwrap();
            let before = (vault.snapshot(), folder.raw());

            vault.set_faults(faults);
            let error = if faults.locked { StoreError::Locked } else { StoreError::Unavailable };
            assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Err(error), "{faults:?}");
            assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Ok(Some(OTHER.into())), "{faults:?}: the file's key meanwhile");
            assert_eq!(store.write("AUTH_KEYS/DeepL_API", "changed"), Err(error));
            assert_eq!((vault.snapshot(), folder.raw()), before, "{faults:?}: nothing changed in either place");
            assert_eq!(store.scope().as_deref(), Some(scope.as_str()));
        }
    }

    #[test]
    fn deleting_removes_the_plain_text_copy_even_when_the_os_store_cannot_answer() {
        let folder = Folder::new();
        let vault = MemoryStore::new();
        let store = folder.store(&vault);
        store.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
        FileStore::new(folder.path()).write("AUTH_KEYS/OpenAI_API", OTHER).unwrap();
        vault.set_faults(Faults { locked: true, ..Faults::default() });
        assert_eq!(store.delete("AUTH_KEYS/OpenAI_API"), Err(StoreError::Locked), "tried again later");
        assert_eq!(folder.file_entry("AUTH_KEYS/OpenAI_API"), None, "the file's copy is gone");
        vault.set_faults(Faults::default());
        store.delete("AUTH_KEYS/OpenAI_API").unwrap();
        store.delete("AUTH_KEYS/DeepL_API").unwrap();
        assert!(vault.snapshot().is_empty());
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(None));
    }

    #[test]
    fn a_copy_left_in_the_file_goes_at_the_next_read_and_a_different_one_stays() {
        let folder = Folder::new();
        let vault = MemoryStore::new();
        let store = folder.store(&vault);
        store.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
        store.write("AUTH_KEYS/OpenAI_API", OTHER).unwrap();
        // As if removing the copies had failed, or the file was edited by hand.
        let file = FileStore::new(folder.path());
        file.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
        file.write("AUTH_KEYS/OpenAI_API", "something-else").unwrap();
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
        assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Ok(Some(OTHER.into())), "the OS store's key is used");
        assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API"), None, "the same copy goes");
        assert_eq!(folder.file_entry("AUTH_KEYS/OpenAI_API").as_deref(), Some("something-else"), "a different one is not lost");
        assert!(store.take_unmoved().is_empty());
    }

    #[test]
    fn a_file_that_is_not_json_is_left_alone_until_a_key_is_kept_and_then_moved_aside() {
        let folder = Folder::new();
        fs::write(folder.path(), b"not json").unwrap();
        let vault = MemoryStore::new();
        let store = folder.store(&vault);
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Err(StoreError::Unreadable));
        assert_eq!(store.delete("AUTH_KEYS/DeepL_API"), Ok(()));
        assert_eq!(fs::read(folder.path()).unwrap(), b"not json", "left as it is");
        write_verified(&store, "AUTH_KEYS/DeepL_API", KEY).unwrap();
        assert_eq!(folder.aside(), 1, "kept beside, never deleted");
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
    }

    #[test]
    fn a_file_with_entries_that_cannot_be_decrypted_keeps_its_id() {
        // Another user's DPAPI entries (on Linux, any "dpapi" file): the id still names the keys.
        let folder = Folder::new();
        let vault = MemoryStore::new();
        let store = folder.store(&vault);
        store.write("AUTH_KEYS/DeepL_API", KEY).unwrap();
        let scope = store.scope().unwrap();
        let sealed = format!(r#"{{"version": 1, "protection": "dpapi", "entries": "AAAA", "store_id": "{scope}"}}"#);
        fs::write(folder.path(), &sealed).unwrap();
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())), "found by the id");
        assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Err(StoreError::Unreadable), "the file cannot say");
        // Keeping a key moves the undecryptable file aside and keeps the id.
        store.write("AUTH_KEYS/OpenAI_API", OTHER).unwrap();
        assert_eq!(folder.aside(), 1);
        assert_eq!(store.scope().as_deref(), Some(scope.as_str()));
        assert_eq!(store.read("AUTH_KEYS/DeepL_API"), Ok(Some(KEY.into())));
        assert_eq!(store.read("AUTH_KEYS/OpenAI_API"), Ok(Some(OTHER.into())));
    }

    #[test]
    fn the_id_is_added_to_an_older_file_without_touching_its_entries() {
        let folder = Folder::new();
        folder.old_file(&[("AUTH_KEYS/DeepL_API", KEY), ("AUTH_KEYS/OpenAI_API", OTHER)]);
        let vault = MemoryStore::new();
        vault.set_faults(Faults { unavailable: true, ..Faults::default() });
        let store = folder.store(&vault);
        // The move fails after the id was written: the entries are all still there.
        assert!(store.write("AUTH_KEYS/DeepL_API", KEY).is_err());
        let file: Value = serde_json::from_str(&folder.raw()).unwrap();
        assert!(file["store_id"].is_string(), "{file}");
        assert_eq!(folder.file_entry("AUTH_KEYS/DeepL_API").as_deref(), Some(KEY));
        assert_eq!(folder.file_entry("AUTH_KEYS/OpenAI_API").as_deref(), Some(OTHER));
    }

    #[test]
    fn errors_never_carry_a_key() {
        for error in [StoreError::Unreadable, StoreError::WriteFailed, StoreError::Unavailable, StoreError::Locked] {
            assert!(!format!("{error:?} {}", error.as_str()).contains(KEY));
        }
    }
}

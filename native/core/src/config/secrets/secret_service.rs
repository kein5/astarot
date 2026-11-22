//! The Secret Service (freedesktop.org) on the session bus: GNOME Keyring, KWallet and others.
//!
//! - Each entry is one item in the default collection, found by the attributes `application`
//!   (`astarot`), `astarot-store` (the scope) and `entry`. Its label names the entry, never the
//!   key. 0.6.0 used `vrct-vox` and `vrct-vox-store`, read through [`SecretService::older`].
//! - The app never opens a keyring or shows the store's dialogs (no `Unlock`, no `Prompt`): a
//!   locked item or collection is [`StoreError::Locked`], and the user opens the keyring in their
//!   own tools. A store that is not on the bus, or no session bus, is
//!   [`StoreError::Unavailable`], as is a call that does not answer within [`TIMEOUT`].
//! - Secrets travel in the spec's `plain` session over the user's own session bus. Encrypting
//!   them on the bus would not keep them from programs of the same user, which ADR-013 leaves out
//!   of scope.

use super::{StoreError, Vault};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use zbus::blocking::Connection;
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

const SERVICE: &str = "org.freedesktop.secrets";
const SERVICE_PATH: &str = "/org/freedesktop/secrets";
const SERVICE_INTERFACE: &str = "org.freedesktop.Secret.Service";
const COLLECTION_INTERFACE: &str = "org.freedesktop.Secret.Collection";
const ITEM_INTERFACE: &str = "org.freedesktop.Secret.Item";
/// How long one call may take before the store counts as not answering.
const TIMEOUT: Duration = Duration::from_secs(5);

/// The names an item is found and labelled by.
#[derive(Clone, Copy)]
struct Names {
    /// The value of the `application` attribute.
    application: &'static str,
    /// The attribute that holds the store ID.
    store_attribute: &'static str,
    /// The first word of the label the keyring shows.
    label_prefix: &'static str,
}

impl Names {
    /// The names this build writes.
    const CURRENT: Names = Names {
        application: astarot_app_identity::credentials::APPLICATION.current(),
        store_attribute: astarot_app_identity::credentials::STORE_ATTRIBUTE.current(),
        label_prefix: astarot_app_identity::credentials::LABEL_PREFIX.current(),
    };
    /// The names 0.6.0 wrote (ADR-014, 2.9).
    const OLDER: Names = Names {
        application: astarot_app_identity::credentials::APPLICATION.legacy,
        store_attribute: astarot_app_identity::credentials::STORE_ATTRIBUTE.legacy,
        label_prefix: astarot_app_identity::credentials::LABEL_PREFIX.legacy,
    };
}

/// A secret as the spec sends it: (session, parameters, value, content type).
type Secret = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);

pub struct SecretService {
    link: Mutex<Option<Link>>,
    names: Names,
}

struct Link {
    connection: Connection,
    session: OwnedObjectPath,
}

/// Why a call failed, before it is named for the settings.
enum Failure {
    Locked,
    Unavailable,
    Other,
}

impl From<zbus::Error> for Failure {
    fn from(error: zbus::Error) -> Self {
        classify(&error)
    }
}

/// What a D-Bus failure means for the keys.
fn classify(error: &zbus::Error) -> Failure {
    match error {
        zbus::Error::MethodError(name, _, _) => match name.as_str() {
            "org.freedesktop.Secret.Error.IsLocked" => Failure::Locked,
            "org.freedesktop.DBus.Error.ServiceUnknown"
            | "org.freedesktop.DBus.Error.NameHasNoOwner"
            | "org.freedesktop.DBus.Error.NoReply"
            | "org.freedesktop.DBus.Error.Timeout"
            | "org.freedesktop.DBus.Error.TimedOut"
            | "org.freedesktop.DBus.Error.Disconnected"
            | "org.freedesktop.DBus.Error.NoServer"
            | "org.freedesktop.DBus.Error.Spawn.ChildExited"
            | "org.freedesktop.DBus.Error.Spawn.Failed"
            | "org.freedesktop.DBus.Error.Spawn.ExecFailed"
            | "org.freedesktop.DBus.Error.ServiceNotFound"
            | "org.freedesktop.DBus.Error.UnknownObject"
            | "org.freedesktop.DBus.Error.UnknownMethod" => Failure::Unavailable,
            _ => Failure::Other,
        },
        zbus::Error::FDO(inner) => match **inner {
            zbus::fdo::Error::ServiceUnknown(_)
            | zbus::fdo::Error::NameHasNoOwner(_)
            | zbus::fdo::Error::NoReply(_)
            | zbus::fdo::Error::Timeout(_)
            | zbus::fdo::Error::TimedOut(_)
            | zbus::fdo::Error::Disconnected(_)
            | zbus::fdo::Error::NoServer(_)
            | zbus::fdo::Error::UnknownObject(_)
            | zbus::fdo::Error::UnknownMethod(_) => Failure::Unavailable,
            _ => Failure::Other,
        },
        zbus::Error::InputOutput(_) | zbus::Error::Connection(_, _) | zbus::Error::Address(_) | zbus::Error::Handshake(_) => {
            Failure::Unavailable
        }
        _ => Failure::Other,
    }
}

fn attributes<'a>(names: Names, scope: &'a str, entry: &'a str) -> HashMap<&'static str, &'a str> {
    HashMap::from([("application", names.application), (names.store_attribute, scope), ("entry", entry)])
}

/// The label the keyring shows for `entry`.
fn item_label(names: Names, entry: &str) -> String {
    format!("{} {entry}", names.label_prefix)
}

/// A path the spec uses for "none" (no prompt, no collection).
fn is_none(path: &ObjectPath<'_>) -> bool {
    path.as_str() == "/"
}

impl SecretService {
    /// The names this build writes.
    pub fn new() -> Self {
        Self { link: Mutex::new(None), names: Names::CURRENT }
    }

    /// The names 0.6.0 wrote, read until the keys move (ADR-014, 2.9). It has a connection of its
    /// own, made only when it is first asked.
    pub fn older() -> Self {
        Self { link: Mutex::new(None), names: Names::OLDER }
    }

    fn connect() -> Result<Link, Failure> {
        let connection = zbus::blocking::connection::Builder::session()?.method_timeout(TIMEOUT).build()?;
        let reply = connection.call_method(Some(SERVICE), SERVICE_PATH, Some(SERVICE_INTERFACE), "OpenSession", &("plain", Value::from("")))?;
        let (_, session): (OwnedValue, OwnedObjectPath) = reply.body().deserialize()?;
        Ok(Link { connection, session })
    }

    /// Runs `call` on the connection, made on first use and made again after the store went away.
    fn with<T>(&self, otherwise: StoreError, call: impl Fn(&Link) -> Result<T, Failure>) -> Result<T, StoreError> {
        let mut link = self.link.lock().unwrap();
        if link.is_none() {
            *link = Some(Self::connect().map_err(|failure| name(failure, StoreError::Unavailable))?);
        }
        let result = call(link.as_ref().expect("connected above"));
        if matches!(result, Err(Failure::Unavailable)) {
            *link = None;
        }
        result.map_err(|failure| name(failure, otherwise))
    }
}

fn name(failure: Failure, otherwise: StoreError) -> StoreError {
    match failure {
        Failure::Locked => StoreError::Locked,
        Failure::Unavailable => StoreError::Unavailable,
        Failure::Other => otherwise,
    }
}

impl Link {
    fn service<B>(&self, method: &str, body: &B) -> Result<zbus::Message, Failure>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        Ok(self.connection.call_method(Some(SERVICE), SERVICE_PATH, Some(SERVICE_INTERFACE), method, body)?)
    }

    /// The items with these attributes: (unlocked, locked).
    fn search(&self, names: Names, scope: &str, entry: &str) -> Result<(Vec<OwnedObjectPath>, Vec<OwnedObjectPath>), Failure> {
        Ok(self.service("SearchItems", &(attributes(names, scope, entry),))?.body().deserialize()?)
    }
}

impl Vault for SecretService {
    fn label(&self) -> &'static str {
        "secret_service"
    }

    fn fetch(&self, scope: &str, entry: &str) -> Result<Option<String>, StoreError> {
        let value = self.with(StoreError::Unreadable, |link| {
            let (unlocked, locked) = link.search(self.names, scope, entry)?;
            let Some(item) = unlocked.into_iter().next() else {
                return if locked.is_empty() { Ok(None) } else { Err(Failure::Locked) };
            };
            let secrets: HashMap<OwnedObjectPath, Secret> =
                link.service("GetSecrets", &(vec![&item], &link.session))?.body().deserialize()?;
            match secrets.into_values().next() {
                Some((_, _, value, _)) => Ok(Some(value)),
                // Locked again between the two calls.
                None => Err(Failure::Locked),
            }
        })?;
        value.map(|bytes| String::from_utf8(bytes).map_err(|_| StoreError::Unreadable)).transpose()
    }

    fn put(&self, scope: &str, entry: &str, value: &str) -> Result<(), StoreError> {
        self.with(StoreError::WriteFailed, |link| {
            let collection: OwnedObjectPath = link.service("ReadAlias", &("default",))?.body().deserialize()?;
            if is_none(&collection) {
                // No default keyring: making one asks the user, which the app does not do.
                return Err(Failure::Unavailable);
            }
            let properties: HashMap<&str, Value<'_>> = HashMap::from([
                ("org.freedesktop.Secret.Item.Label", Value::from(item_label(self.names, entry))),
                ("org.freedesktop.Secret.Item.Attributes", Value::from(attributes(self.names, scope, entry))),
            ]);
            let secret = (&link.session, Vec::<u8>::new(), value.as_bytes(), "text/plain; charset=utf8");
            let reply = link.connection.call_method(
                Some(SERVICE),
                collection.as_str(),
                Some(COLLECTION_INTERFACE),
                "CreateItem",
                &(properties, secret, true),
            )?;
            let (item, prompt): (OwnedObjectPath, OwnedObjectPath) = reply.body().deserialize()?;
            if !is_none(&prompt) || is_none(&item) {
                // The collection is locked: the store wants to ask the user.
                return Err(Failure::Locked);
            }
            Ok(())
        })
    }

    fn remove(&self, scope: &str, entry: &str) -> Result<(), StoreError> {
        self.with(StoreError::WriteFailed, |link| {
            let (unlocked, locked) = link.search(self.names, scope, entry)?;
            for item in &unlocked {
                let reply = link.connection.call_method(Some(SERVICE), item.as_str(), Some(ITEM_INTERFACE), "Delete", &())?;
                let prompt: OwnedObjectPath = reply.body().deserialize()?;
                if !is_none(&prompt) {
                    return Err(Failure::Locked);
                }
            }
            if locked.is_empty() { Ok(()) } else { Err(Failure::Locked) }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The names this build writes (ADR-014, 2.2), and those 0.6.0 wrote, under which its keys
    /// are still found.
    #[test]
    fn items_are_named_astarot_and_found_under_the_names_of_0_6_0() {
        let current = attributes(Names::CURRENT, "0123456789abcdef", "AUTH_KEYS/DeepL_API");
        let expected = HashMap::from([("application", "astarot"), ("astarot-store", "0123456789abcdef"), ("entry", "AUTH_KEYS/DeepL_API")]);
        assert_eq!(current, expected);
        assert_eq!(item_label(Names::CURRENT, "AUTH_KEYS/DeepL_API"), "ASTAROT AUTH_KEYS/DeepL_API");
        let older = attributes(Names::OLDER, "0123456789abcdef", "AUTH_KEYS/DeepL_API");
        let expected = HashMap::from([("application", "vrct-vox"), ("vrct-vox-store", "0123456789abcdef"), ("entry", "AUTH_KEYS/DeepL_API")]);
        assert_eq!(older, expected);
        assert_eq!(item_label(Names::OLDER, "AUTH_KEYS/DeepL_API"), "VRCT-VOX AUTH_KEYS/DeepL_API");
    }

    #[test]
    fn a_store_that_is_not_there_or_locked_is_a_passing_failure() {
        let name_error = |name: &str| {
            let error = zbus::Error::MethodError(
                zbus::names::OwnedErrorName::try_from(name).unwrap(),
                None,
                zbus::Message::method_call("/", "Ping").unwrap().build(&()).unwrap(),
            );
            super::name(classify(&error), StoreError::Unreadable)
        };
        assert_eq!(name_error("org.freedesktop.Secret.Error.IsLocked"), StoreError::Locked);
        assert_eq!(name_error("org.freedesktop.DBus.Error.ServiceUnknown"), StoreError::Unavailable);
        assert_eq!(name_error("org.freedesktop.DBus.Error.NoReply"), StoreError::Unavailable);
        assert_eq!(name_error("org.freedesktop.Secret.Error.NoSuchObject"), StoreError::Unreadable);
        let io = zbus::Error::InputOutput(std::sync::Arc::new(std::io::Error::from(std::io::ErrorKind::TimedOut)));
        assert_eq!(super::name(classify(&io), StoreError::WriteFailed), StoreError::Unavailable);
    }

    #[test]
    fn no_session_bus_is_unavailable() {
        // An address with nothing behind it stands in for a desktop without a session bus.
        let dir = std::env::temp_dir().join(format!("vrct-no-bus-{}", super::super::new_store_id()));
        let previous = std::env::var_os("DBUS_SESSION_BUS_ADDRESS");
        // SAFETY: only this test reads or writes the variable while it runs.
        unsafe { std::env::set_var("DBUS_SESSION_BUS_ADDRESS", format!("unix:path={}", dir.join("bus").display())) };
        let store = SecretService::new();
        let result = store.fetch("0123456789abcdef", "AUTH_KEYS/DeepL_API");
        match previous {
            Some(value) => unsafe { std::env::set_var("DBUS_SESSION_BUS_ADDRESS", value) },
            None => unsafe { std::env::remove_var("DBUS_SESSION_BUS_ADDRESS") },
        }
        assert_eq!(result, Err(StoreError::Unavailable));
    }

    /// A real Secret Service on the session bus (GNOME Keyring in CI, started with an unlocked
    /// login keyring under `dbus-run-session`). It writes one item under a scope of its own and
    /// removes it. Run with `cargo test -- --ignored secret_service`.
    #[test]
    #[ignore = "needs a Secret Service on the session bus"]
    fn secret_service_keeps_reads_and_removes_a_key() {
        let scope = format!("test{}", &super::super::new_store_id()[..12]);
        let store = SecretService::new();
        let entry = "AUTH_KEYS/DeepL_API";
        let value = "test-value-not-a-real-key";
        assert_eq!(store.fetch(&scope, entry), Ok(None));
        store.put(&scope, entry, value).unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(Some(value.to_string())));
        store.put(&scope, entry, "changed").unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(Some("changed".to_string())), "replaced, not added");
        assert_eq!(store.fetch(&scope, "AUTH_KEYS/OpenAI_API"), Ok(None), "another entry is another item");
        store.remove(&scope, entry).unwrap();
        assert_eq!(store.fetch(&scope, entry), Ok(None));
        store.remove(&scope, entry).unwrap();
    }
}

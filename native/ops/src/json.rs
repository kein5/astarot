//! JSON that keeps the order of an object's keys, written the way Python's `json` writes it.
//!
//! The settings page shows a usage event and the record of what was sent as JSON, key by key
//! (`JSON.stringify`), and the Python backend wrote them in the order it built them. A
//! `serde_json::Value` sorts the keys, and turning on its `preserve_order` feature here would
//! also change it for the whole application once this crate is linked into it. So the few
//! documents whose order is visible go through [`Json`] instead.

use std::fmt;

use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::ser::{Formatter, PrettyFormatter};

/// A JSON value whose objects keep their keys in insertion order.
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<Json>),
    Object(Object),
}

/// A JSON object in insertion order. A key set again keeps its first position, as in a
/// Python `dict`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Object(Vec<(String, Json)>);

impl Object {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<Json>) {
        let key = key.into();
        let value = value.into();
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }

    /// The object with one more key, for building literals.
    pub fn with(mut self, key: impl Into<String>, value: impl Into<Json>) -> Self {
        self.insert(key, value);
        self
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn remove(&mut self, key: &str) -> Option<Json> {
        let index = self.0.iter().position(|(k, _)| k == key)?;
        Some(self.0.remove(index).1)
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Json)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Equality regardless of key order, the way two Python dicts compare.
    pub fn same_as(&self, other: &Object) -> bool {
        self.len() == other.len() && self.iter().all(|(k, v)| other.get(k).is_some_and(|o| v.same_as(o)))
    }
}

impl Json {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Json::Object(o) => Some(o),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        self.as_object().and_then(|o| o.get(key))
    }

    /// Equality regardless of the key order of any object inside.
    pub fn same_as(&self, other: &Json) -> bool {
        match (self, other) {
            (Json::Object(a), Json::Object(b)) => a.same_as(b),
            (Json::Array(a), Json::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.same_as(y)),
            (a, b) => a == b,
        }
    }

    pub fn parse(text: &str) -> serde_json::Result<Json> {
        serde_json::from_str(text)
    }

    pub fn parse_slice(bytes: &[u8]) -> serde_json::Result<Json> {
        serde_json::from_slice(bytes)
    }

    /// Any serializable value, keys in the order it writes them (a struct's field order).
    pub fn from_serialize<T: Serialize>(value: &T) -> Json {
        let text = serde_json::to_string(value).expect("a value made of plain data always serializes");
        serde_json::from_str(&text).expect("serde_json reads back what it wrote")
    }

    /// `json.dumps(value, ensure_ascii=False, indent=2)`.
    pub fn to_python_indented(&self) -> String {
        let mut out = Vec::new();
        let mut serializer = serde_json::Serializer::with_formatter(&mut out, PrettyFormatter::with_indent(b"  "));
        self.serialize(&mut serializer).expect("writing to memory does not fail");
        String::from_utf8(out).expect("serde_json writes UTF-8")
    }

    /// `json.dumps(value, ensure_ascii=True, separators=(",", ":"))`.
    pub fn to_python_compact_ascii(&self) -> String {
        ascii_escape(&serde_json::to_string(self).expect("writing to memory does not fail"))
    }

    /// `json.dumps(value)`: `", "` and `": "` between items, and ASCII only.
    pub fn to_python_default(&self) -> String {
        let mut out = Vec::new();
        let mut serializer = serde_json::Serializer::with_formatter(&mut out, PythonDefault);
        self.serialize(&mut serializer).expect("writing to memory does not fail");
        ascii_escape(&String::from_utf8(out).expect("serde_json writes UTF-8"))
    }
}

/// Python's default separators: a space after each comma and colon.
struct PythonDefault;

impl Formatter for PythonDefault {
    fn begin_array_value<W: ?Sized + std::io::Write>(&mut self, writer: &mut W, first: bool) -> std::io::Result<()> {
        if first {
            Ok(())
        } else {
            writer.write_all(b", ")
        }
    }

    fn begin_object_key<W: ?Sized + std::io::Write>(&mut self, writer: &mut W, first: bool) -> std::io::Result<()> {
        if first {
            Ok(())
        } else {
            writer.write_all(b", ")
        }
    }

    fn begin_object_value<W: ?Sized + std::io::Write>(&mut self, writer: &mut W) -> std::io::Result<()> {
        writer.write_all(b": ")
    }
}

/// Every character above U+007F as `\uXXXX` (UTF-16, lowercase hex), as `ensure_ascii` does.
/// Outside strings serde_json writes ASCII only, so this touches string contents alone.
fn ascii_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

impl From<&str> for Json {
    fn from(value: &str) -> Self {
        Json::String(value.to_string())
    }
}

impl From<String> for Json {
    fn from(value: String) -> Self {
        Json::String(value)
    }
}

impl From<bool> for Json {
    fn from(value: bool) -> Self {
        Json::Bool(value)
    }
}

impl From<u64> for Json {
    fn from(value: u64) -> Self {
        Json::Number(value.into())
    }
}

impl From<i64> for Json {
    fn from(value: i64) -> Self {
        Json::Number(value.into())
    }
}

impl From<u32> for Json {
    fn from(value: u32) -> Self {
        Json::Number(value.into())
    }
}

impl From<Object> for Json {
    fn from(value: Object) -> Self {
        Json::Object(value)
    }
}

impl From<Vec<Json>> for Json {
    fn from(value: Vec<Json>) -> Self {
        Json::Array(value)
    }
}

impl<T: Into<Json>> From<Option<T>> for Json {
    fn from(value: Option<T>) -> Self {
        value.map_or(Json::Null, Into::into)
    }
}

impl Serialize for Json {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Json::Null => serializer.serialize_unit(),
            Json::Bool(b) => serializer.serialize_bool(*b),
            Json::Number(n) => n.serialize(serializer),
            Json::String(s) => serializer.serialize_str(s),
            Json::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Json::Object(object) => object.serialize(serializer),
        }
    }
}

impl Serialize for Object {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(JsonVisitor)
    }
}

struct JsonVisitor;

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Json;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_unit<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_none<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_bool<E>(self, v: bool) -> Result<Json, E> {
        Ok(Json::Bool(v))
    }

    fn visit_i64<E>(self, v: i64) -> Result<Json, E> {
        Ok(Json::Number(v.into()))
    }

    fn visit_u64<E>(self, v: u64) -> Result<Json, E> {
        Ok(Json::Number(v.into()))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Json, E> {
        serde_json::Number::from_f64(v).map(Json::Number).ok_or_else(|| E::custom("not a finite number"))
    }

    fn visit_str<E>(self, v: &str) -> Result<Json, E> {
        Ok(Json::String(v.to_string()))
    }

    fn visit_string<E>(self, v: String) -> Result<Json, E> {
        Ok(Json::String(v))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Json::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
        let mut object = Object::new();
        while let Some((key, value)) = map.next_entry::<String, Json>()? {
            object.insert(key, value);
        }
        Ok(Json::Object(object))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_key_order_and_a_repeated_key_keeps_its_place() {
        let parsed = Json::parse(r#"{"b": 1, "a": [true, null], "b": "x"}"#).unwrap();
        let object = parsed.as_object().unwrap();
        assert_eq!(object.keys().collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(object.get("b"), Some(&Json::from("x")));
    }

    #[test]
    fn writes_what_python_writes() {
        let value = Json::from(Object::new().with("event", "app").with("name", "PP-OCRv6 · 日本").with("list", vec![]).with("n", 2u64));
        assert_eq!(value.to_python_compact_ascii(), r#"{"event":"app","name":"PP-OCRv6 \u00b7 \u65e5\u672c","list":[],"n":2}"#);
        assert_eq!(value.to_python_default(), r#"{"event": "app", "name": "PP-OCRv6 \u00b7 \u65e5\u672c", "list": [], "n": 2}"#);
        assert_eq!(value.to_python_indented(), "{\n  \"event\": \"app\",\n  \"name\": \"PP-OCRv6 · 日本\",\n  \"list\": [],\n  \"n\": 2\n}");
        // Outside the Basic Multilingual Plane: a surrogate pair, as Python writes it.
        assert_eq!(Json::from("🎤").to_python_compact_ascii(), r#""\ud83c\udfa4""#);
    }

    #[test]
    fn compares_like_python_dicts_when_asked() {
        let a = Json::parse(r#"{"x": {"p": 1, "q": 2}}"#).unwrap();
        let b = Json::parse(r#"{"x": {"q": 2, "p": 1}}"#).unwrap();
        assert!(a.same_as(&b) && a != b);
    }
}

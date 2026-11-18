"""The translation provider contract (issue #277), held against the Python clients.

`native/translation/tests/contract/providers.json` gives, for every provider, scenarios: what
is asked of the provider and what it answers. This test runs each scenario against the Python
clients of `models/translation/` with the network replaced at the transport (httpx and
requests), and compares what they sent and returned with the case's `python` record. The Rust
providers are held to the same records by `native/translation/tests/contract.rs`, so the file
stays the specification of the providers once the Python clients are gone.

After changing a scenario, record again with `VRCT_TRANSLATION_CONTRACT_WRITE=1`. Nothing goes
to the network; the keys in the file are made up.
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
import requests

REPO = Path(__file__).resolve().parents[2]
CONTRACT = REPO / "native" / "translation" / "tests" / "contract" / "providers.json"
WRITE = os.environ.get("VRCT_TRANSLATION_CONTRACT_WRITE") == "1"

# Headers every HTTP library or SDK adds on its own: not part of a provider's request.
NOISE_HEADERS = {
    "host", "accept", "accept-encoding", "connection", "content-length", "user-agent",
    "x-goog-api-client", "x-server-timeout",
}
NOISE_PREFIXES = ("x-stainless-",)

PROVIDERS = {
    "DeepL_API", "Plamo_API", "Gemini_API", "OpenAI_API", "Groq_API", "OpenRouter_API",
    "OpenAI_Compatible", "LMStudio", "Ollama",
}


def _load():
    with open(CONTRACT, encoding="utf-8") as fp:
        return json.load(fp)


DOCUMENT = _load()
CASES = [case for case in DOCUMENT["cases"] if case["provider"] in PROVIDERS]


# ----------------------------------------------------------------------------- the network


def normalized_url(url):
    parts = urlsplit(str(url))
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))


def url_without_query(url):
    parts = urlsplit(normalized_url(url))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def normalized_body(content):
    if not content:
        return None
    if isinstance(content, bytes):
        content = content.decode("utf-8")
    try:
        return json.loads(content)
    except ValueError:
        return content


def normalized_headers(headers, body):
    kept = {}
    for name, value in headers.items():
        name = name.lower()
        if name in NOISE_HEADERS or name.startswith(NOISE_PREFIXES):
            continue
        if name == "content-type" and body is None:
            continue
        kept[name] = value
    return dict(sorted(kept.items()))


def httpx_timeouts(extension):
    extension = extension or {}
    return {"connect": extension.get("connect"), "read": extension.get("read"), "write": extension.get("write")}


def requests_timeouts(timeout):
    if isinstance(timeout, (tuple, list)):
        connect, read = timeout
    else:
        connect = read = timeout
    # requests has no separate wait for writing.
    return {"connect": float(connect), "read": float(read), "write": None}


class Network:
    """Answers each request from the case's script and keeps what was sent."""

    def __init__(self, answers):
        self.answers = [dict(answer, at=0) for answer in answers]
        self.seen = []

    def reply(self, method, url):
        key = url_without_query(url)
        for answer in self.answers:
            if answer["method"] == method and url_without_query(answer["url"]) == key:
                replies = answer["replies"]
                reply = replies[min(answer["at"], len(replies) - 1)]
                answer["at"] += 1
                return reply
        return {"status": 404, "body": {"error": "no answer in the contract"}}

    def record(self, method, url, headers, body, timeout):
        self.seen.append({
            "method": method,
            "url": normalized_url(url),
            "headers": normalized_headers(headers, body),
            "body": body,
            "timeout": timeout,
        })

    def httpx(self, transport, request):
        request.read()
        body = normalized_body(request.content)
        self.record(request.method, request.url, request.headers, body, httpx_timeouts(request.extensions.get("timeout")))
        reply = self.reply(request.method, str(request.url))
        if "error" in reply and "status" not in reply:
            raise httpx.ConnectError("contract: no connection", request=request)
        return httpx.Response(reply["status"], json=reply["body"], request=request)

    def requests(self, adapter, request, **kwargs):
        body = normalized_body(request.body)
        self.record(request.method, request.url, request.headers, body, requests_timeouts(kwargs.get("timeout")))
        reply = self.reply(request.method, request.url)
        if "error" in reply and "status" not in reply:
            raise requests.ConnectionError("contract: no connection", request=request)
        response = requests.Response()
        response.status_code = reply["status"]
        response._content = json.dumps(reply["body"]).encode("utf-8")
        response.headers["Content-Type"] = "application/json"
        response.url = request.url
        response.request = request
        response.encoding = "utf-8"
        return response


# ----------------------------------------------------------------------------- the clients


def _client(provider, access):
    from models.translation.translation_gemini import GeminiClient
    from models.translation.translation_groq import GroqClient
    from models.translation.translation_lmstudio import LMStudioClient
    from models.translation.translation_ollama import OllamaClient
    from models.translation.translation_openai import OpenAIClient
    from models.translation.translation_openai_compatible import OpenAICompatibleClient
    from models.translation.translation_openrouter import OpenRouterClient
    from models.translation.translation_plamo import PlamoClient

    match provider:
        case "Plamo_API":
            return PlamoClient()
        case "Gemini_API":
            return GeminiClient()
        case "OpenAI_API":
            return OpenAIClient()
        case "Groq_API":
            return GroqClient()
        case "OpenRouter_API":
            return OpenRouterClient()
        case "OpenAI_Compatible":
            return OpenAICompatibleClient(base_url=access["base"])
        case "LMStudio":
            return LMStudioClient(base_url=access["base"])
        case "Ollama":
            client = OllamaClient()
            client.base_url = access["base"]
            return client
    raise AssertionError(provider)


def _check(provider, access):
    """What the controller does when a key or an address is saved (`prepareCredential`,
    `setLMStudioClientURL`, `checkOllamaClient`), up to the list of models."""
    if provider == "DeepL_API":
        from deepl import DeepLClient
        from models.translation.translation_deepl import authenticateDeepL
        try:
            authenticateDeepL(DeepLClient, access["key"])
        except Exception:
            return {"accepted": False}
        return {"accepted": True, "models": []}
    client = _client(provider, access)
    try:
        if provider == "LMStudio":
            accepted = client.setBaseURL(access["base"])
        elif provider == "Ollama":
            accepted = client.authenticationCheck()
        else:
            accepted = client.setAuthKey(access["key"])
        if not accepted:
            return {"accepted": False}
        return {"accepted": True, "models": list(client.getModelList())}
    except Exception:
        return {"accepted": False}


def _ready(provider, access):
    """A client as it is after a successful check: key, address and model set."""
    client = _client(provider, access)
    if "key" in access and provider not in ("LMStudio", "Ollama"):
        client.api_key = access["key"]
    if "model" in access:
        client.model = access["model"]
    return client


def _models(provider, access):
    return {"models": list(_ready(provider, access).getModelList())}


def _translate(provider, access, translation):
    try:
        if provider == "DeepL_API":
            from deepl import DeepLClient
            from models.translation.translation_deepl import configureDeepLRuntimeTimeout
            key = access["key"]
            base = "https://api-free.deepl.com" if key.endswith(":fx") else "https://api.deepl.com"
            client = DeepLClient(key, server_url=base)
            configureDeepLRuntimeTimeout(client)
            text = client.translate_text(
                translation["text"], source_lang=translation["source"], target_lang=translation["target"]).text
        else:
            client = _ready(provider, access)
            client.updateClient()
            client.setContextHistory(translation["history"])
            text = client.translate(translation["text"], translation["source"], translation["target"])
    except Exception:
        return {"failed": True}
    assert isinstance(text, str), type(text)
    return {"text": text}


def supported_languages(provider):
    if provider == "DeepL_API":
        return None
    return list(_client(provider, {"base": "http://127.0.0.1:1/v1"}).supported_languages)


def run(case):
    network = Network(case["answers"])
    quiet = [patch("utils.errorLogging", lambda *args, **kwargs: None)]
    for name, module in list(sys.modules.items()):
        if name.startswith("models.translation.") and hasattr(module, "errorLogging"):
            quiet.append(patch.object(module, "errorLogging", lambda *args, **kwargs: None))
    with (
        patch.object(httpx.HTTPTransport, "handle_request", lambda transport, request: network.httpx(transport, request)),
        patch.object(requests.adapters.HTTPAdapter, "send", lambda adapter, request, **kw: network.requests(adapter, request, **kw)),
    ):
        for quieting in quiet:
            quieting.start()
        try:
            provider, access = case["provider"], case["access"]
            match case["operation"]:
                case "check":
                    outcome = _check(provider, access)
                case "models":
                    outcome = _models(provider, access)
                case "translate":
                    outcome = _translate(provider, access, case["translation"])
                case other:
                    raise AssertionError(other)
        finally:
            for quieting in quiet:
                quieting.stop()
    return {"requests": network.seen, "outcome": outcome}


# ----------------------------------------------------------------------------- the tests


@pytest.fixture(scope="module", autouse=True)
def languages():
    from models.translation.translation_languages import loadTranslationLanguages
    loadTranslationLanguages(path=str(REPO / "src-python"), force=True)


@pytest.fixture(scope="module")
def recorded():
    records = {}
    yield records
    if WRITE and records:
        document = _load()
        for case in document["cases"]:
            if case["id"] in records:
                case["python"] = records[case["id"]]
        document["supported_languages"] = {
            provider: supported_languages(provider) for provider in sorted(PROVIDERS) if provider != "DeepL_API"
        }
        with open(CONTRACT, "w", encoding="utf-8", newline="\n") as fp:
            json.dump(document, fp, ensure_ascii=False, indent=2)
            fp.write("\n")


def _comparable(record):
    """Timeouts as floats, so that 2 and 2.0 compare equal."""
    record = json.loads(json.dumps(record))
    for request in record["requests"]:
        request["timeout"] = {k: (None if v is None else float(v)) for k, v in request["timeout"].items()}
    return record


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_the_python_client_keeps_the_contract(case, recorded):
    record = run(case)
    recorded[case["id"]] = record
    if WRITE:
        return
    assert "python" in case, f"{case['id']} has no Python record; record it with VRCT_TRANSLATION_CONTRACT_WRITE=1"
    assert _comparable(record) == _comparable(case["python"])


def test_the_prompts_list_the_languages_of_the_contract():
    if WRITE:
        return
    for provider, listed in DOCUMENT.get("supported_languages", {}).items():
        assert supported_languages(provider) == listed, provider


def test_every_python_provider_has_cases():
    assert {case["provider"] for case in CASES} == PROVIDERS

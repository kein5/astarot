# External interfaces

[日本語版](#外部インターフェース日本語版)

The points where ASTAROT exchanges data with other programs. The interface between the UI and the sidecar is in the [IPC protocol](ipc-protocol.md).

## OSC to VRChat

`native/adapters/src/osc/` (up to 0.5, Python's [`osc.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/osc/osc.py), using python-osc, with the optional tinyoscquery for OSCQuery).

| Direction | Address | Arguments | When it is sent |
|---|---|---|---|
| Send | `/chatbox/input` | `[文字列, true, 通知音]` (a string, `true`, the notification sound) | "Send message to VRChat" is on (input box and microphone), or "Send received message to VRChat" is on (speaker). An empty string is not sent |
| Send | `/chatbox/typing` | `[真偽]` (a boolean) | The typing indicator. `true` is sent only while "Send message to VRChat" is on. `false`, which clears an indicator the app turned on, is sent even after the send setting has been turned off |
| Receive | `/avatar/parameters/MuteSelf` | Boolean | VRC mic mute sync |
| Receive | `/avatar/change` | — | When the avatar changes, `MuteSelf` is read again |

- The destination is `OSC_IP_ADDRESS` and `OSC_PORT` (default `127.0.0.1:9000`). The notification sound is `NOTIFICATION_VRC_SFX`.
- If the saved destination cannot be opened at startup (for example, a `config.json` edited by hand), the destination address is reset to `127.0.0.1` and saved, and sending and receiving start there. After initialization, `VALIDATION_CANNOT_SET_IP` is sent as a 400 notification on `/set/data/osc_ip_address`, with the address in use in `data`. If `127.0.0.1` cannot be opened either, the same notification is sent with the saved value left as it is, and nothing is sent. The Python version could not start in this case.
- A send action from the input box clears the typing indicator even when the box is empty or sending fails. Emptying the box, automatic clearing, moving the focus and turning off sending to VRChat also clear it. Typing notifications are still sent at least 2 seconds apart. Quick Chat sends no typing notifications; when it sends a message, the shared code path clears the indicator.
- Text read by OCR and real-time captions are not sent to VRChat.
- When "Send only translated messages" is on, only the translation is sent. The form of the sent text is set by the message formats on the VRChat page of Settings.
- The send destination and the receive bind address are independent. OSCQuery is used only when the destination is `127.0.0.1` or `localhost`, and UDP reception and HTTP always bind to a free port on `127.0.0.1`. The receiver is advertised under the name `ASTAROT:<時刻>` (`VRCT:<時刻>` up to 0.5.x), where `<時刻>` is a time. When the destination is switched back from another machine, reception also restarts on loopback.
- The receiver's advertisement and discovery (mDNS) do not leave the PC (#559). Every packet sent has its IP TTL set to 0. The OS delivers such packets only to members of the group on the same PC (VRChat among them) and does not send them to the network. Packets whose sender is not the same PC (loopback or the PC's own address) are ignored, so queries from other machines get no answer and their advertisements are not remembered. The advertised address is `127.0.0.1`, so other machines could not use this receiver before either. With joining and sending limited to the loopback interface, the app and VRChat (checked in desktop mode on Windows) cannot find each other.
- On Windows, mDNS does not receive on UDP port 5353 (#442), because listening on 5353 makes Windows Firewall ask, for each executable path, whether to allow incoming traffic. For each interface, the app creates a socket on `0.0.0.0` with a port the OS chooses, and only sends from it. Advertised services are announced again every 5 seconds, so a VRChat started after the app also gets them. Discovery queries are sent from a port other than 5353, so the answers come straight back to the querying socket (legacy unicast, RFC 6762 section 6.7). The TTL of these answers is at most 10 seconds, so queries are sent at most 5 seconds apart. Two programs that both do not receive on 5353 cannot find each other. Linux receives on 5353.
- The user can turn OSCQuery off (`OSC_QUERY`, on by default; the "Advanced" page of Settings; core only, #559). While it is off, none of UDP reception, HTTP, advertisement or discovery starts. Changing the destination does not start them either, and if they are running when it is turned off, they stop and the advertisement is withdrawn. Sending to the chatbox and the typing indicator do not change. VRC mic mute sync cannot be used, and VRChat presence becomes `"unknown"`. When it is turned back on, reception starts on the current destination. The endpoints are `/get/data/osc_query`, `/set/enable/osc_query` and `/set/disable/osc_query`; after either switch, `/run/enable_osc_query` reports the result of the setup.
- Starting OSC, stopping it and changing its IP or port are serialized by one lifecycle lock. A setting is committed only after the new receiver and advertisement are ready; on failure, the previous receiver and advertisement are restored. If the restore also fails, the setting value is kept and the capability is reported as disabled. A start after a shutdown request is refused.
- Reception does not wait on a bundle's timestamp; the messages inside are handled when the bundle arrives. Reception runs on one thread, and that thread uses only the server it was created with.
- HTTP has a read deadline of 2 seconds per request. On replacement, shutdown or a failure partway through initialization, UDP and HTTP are closed, the advertisement is withdrawn, Zeroconf is closed and the discovery browser is stopped. The app waits up to 2 seconds for cleanup. If it does not finish, the reference to the owner is kept, and nothing replaces it until cleanup finishes. At exit, the wait for the startup and settings-change lock is also at most 2 seconds.
- The capability is enabled only when UDP reception, HTTP, the OSCQuery advertisement and the discovery browser have all been set up successfully. Its initial value in the UI is also disabled. If the destination is not local, if tinyoscquery is missing or if binding or advertising fails, `/run/enable_osc_query` sends `{"data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": …, "microphone_stopped": …}` at startup and after a settings change. `reason` is `turned_off` if the user has turned OSCQuery off (chosen ahead of the other reasons), `remote_destination` if the destination is another machine, and `setup_failed` if setup failed although the destination is this PC. `microphone_stopped` is true when microphone input was stopped because sync was on. The UI picks the wording of its message from these two, and the sync field on the settings screen also shows the reason that matches `reason`. When the destination is another machine, the UI does not suggest fixing the OSC settings. If sync was on, microphone input is stopped first, then sync is turned off, and the state of both switches is reported. However, when the app merely started with the destination set to another machine, or with OSCQuery off, and sync was off from the start, `disabled_functions` is sent empty. Nothing was stopped and the state is what the settings chose, so the UI shows no message. In this case too the capability is disabled, and the sync field on the settings screen shows the reason. Transcription is not resumed automatically. Turning sync on in this state gives `VRC_MIC_MUTE_SYNC_OSC_DISABLED`.
- When mute sync is on and VRChat is muted, microphone recognition results are discarded.
- `MuteSelf=true` is applied to the mute state at once and pauses microphone transcription. A `false` that arrives while muted does not resume it by itself: the app reads `/avatar/parameters/MuteSelf` again through the OSCQuery of the local VRChat, verified under the conditions below, and resumes only when it confirms the boolean `false`. If VRChat cannot be reached, the value is missing, the value is not a boolean or the query times out, the mute is kept and the reason is recorded with `printLog`.
- Of the discovery results, only those whose resolved IPv4 addresses are all loopback and whose service name matches `VRChat-Client`, or that name with an identifier attached, are checked over HTTP. The check confirms that `HOST_INFO.NAME` matches the service name, `OSC_IP` is loopback, `OSC_PORT` is the configured send port and `OSC_TRANSPORT` is `UDP`. If the candidates cannot be narrowed down to one, the mute is not lifted. Advertisements from the LAN and advertisements that match the name only partly are not queried, and neither HTTP redirects nor proxies from environment variables are used. This is a boundary that trusts local processes, not cryptographic authentication of the VRChat process.
- The OSCQuery timeout is 2 seconds, including service discovery and the wait for the lifecycle lock. The check runs outside the OSC receive thread and the microphone operation queue, and a `true` that arrives during the check takes priority over the older result. A result that timed out is not used even if it arrives later. The request itself cannot be interrupted, so at most one query is in flight, and until it finishes, new queries are treated as unable to get the value.
- `/get/data/vrchat_osc_presence` returns whether a VRChat with OSC enabled is visible on this PC, as `"found"`, `"not_found"` or `"unknown"`. VRChat advertises OSCQuery only while OSC is enabled. The app queries `HOST_INFO` from a local VRChat found by discovery (one whose name starts with `VRChat-Client` and whose addresses are loopback only), and returns `found` if it answers. A closed VRChat stays in the discovery results for a while, so the answer is what confirms it. If nothing answers, `not_found` is returned and discovery is queried again. VRChat announces itself only once at startup, so a VRChat started after the app is found on the next call thanks to this re-query. When OSCQuery is not in use (turned off, the destination is another machine, or reception has not started), the result is `unknown`. It is not part of the bulk fetch at startup. The UI shows it in words on the VRChat page of Settings and in the quick settings on the main screen, and fetches it every 5 seconds while it is shown. The main screen's view with an empty conversation also fetches it at the same interval while shown, and shows a one-line guide to enabling OSC in VRChat only while the result is `not_found` (`src-ui/views/app/others/vrchat_presence/VrchatOscHint.tsx`). The line is not shown before the first answer, or for `found` or `unknown`. While sending is off and while OSCQuery is off, nothing is fetched and this line is not shown. The VR panel does not fetch it. While "Send message to VRChat" is off, nothing is fetched and the display says it is off. "Sent" in the message log only means the message went out, so this display is what shows whether it can arrive.
- On `/avatar/change`, the app first mutes, then schedules a re-read. Running and waiting jobs are merged into one, and further notifications keep only the latest generation. The generation is checked before the query and before the result is applied, so a `true` that arrived later is not overwritten. On shutdown, intake is closed, waiting jobs are cancelled and the executor is shut down too. A query never recreates the discovery browser.
- Turning sync on or off, the sync at startup and changes from reception pause and resume transcription through the same Controller lock that microphone start, stop and device changes use. Operations triggered by reception use the microphone operation queue. The microphone lock is not held while waiting for a query. While the state is unknown, such as at startup or right after sync is turned on, transcription is also paused and delivery of results stops.
- The sent text has no length limit and is not split. Handling VRChat's limits is listed in the [open issues](open-issues.md).

## WebSocket server

`native/adapters/src/websocket.rs`. Streams the conversation to other apps.

| Item | Details |
|---|---|
| Enabling | `WEBSOCKET_SERVER` (off by default). Turning on the OBS browser source turns it on too. The app waits up to 6 seconds for listening to start; on timeout or a stop request, it cancels the startup and does not turn the server on. If a host or port change cannot bind, the server is rebuilt on the old address and an error is returned |
| Listening | `WEBSOCKET_HOST` (default `127.0.0.1`; IPv4 only; `0.0.0.0`, IPv6 and host names are refused), `WEBSOCKET_PORT` (default 2231, an integer from 1 to 65535) |
| Encryption | On loopback (127.0.0.0/8) it stays `ws://`. On any other address, only `wss://` (TLS 1.2 or later) with the certificate and private key the user specified is used. Without a usable certificate it does not listen ([Listening outside the local PC](#listening-outside-the-local-pc)) |
| Authentication | Connect with `?token=<WEBSOCKET_AUTH_TOKEN>`. If it does not match, HTTP 403 is returned before the connection opens. The token is created at first startup and shown masked on the settings screen. If the saved value is null, only whitespace, an empty string or not a string, a newly generated default secret is saved. Without a non-empty token, the server does not start. Regenerating it with `/run/regenerate_websocket_auth_token` drops connections that used the old token at once and refuses that token from then on |
| Receiving | Not used. The app registers no receive handler, and received messages are discarded on the event loop (not passed to a worker thread). One message is at most 64 KiB. Per connection, it accepts on average up to 10 messages and 128 KiB per second, and up to 20 messages and 256 KiB in a short burst. A connection that exceeds either is closed with 1008 (policy violation), and if it has not closed after 2 seconds, its transport is aborted (security audit SEC-06). The limits are the `INCOMING_*` and `MAX_INCOMING_MESSAGE_SIZE` constants in `native/adapters/src/websocket.rs` |
| Sending | For each processed message, the [message shape](data-and-persistence.md#websocketとobsへ送るメッセージ) is sent to all clients. When the OBS display settings change, `SETTINGS_UPDATED` is sent |

The host and port are saved, and the server restarted, only after they pass the validation in [network settings](data-and-persistence.md#ネットワーク設定). WebSocket and OBS both use IPv4 only, with the same bind pre-check and the same format for the URL that is copied.

While it is starting, the server does not listen yet, and it accepts connections only if setup finishes within the deadline. A cancelled startup that completes late does not start listening. The loop and the socket are closed on the thread of that startup, and the app waits up to 2 seconds for them to end (separate from the 6 seconds of the startup wait). If work that cannot be interrupted remains, the reference is kept, and restarts are reported as failures until it ends. Disabling the server or changing the host or port during startup also cancels the startup from before the change.

### Listening outside the local PC

If the server listens on an address other than loopback, anyone who can observe traffic on the same network can read the token and the conversation (security audit SEC-01). So outside loopback, WebSocket and OBS listen only over TLS (`native/adapters/src/tls.rs`).

- The certificate and private key are `WEBSOCKET_TLS_CERT_FILE` and `WEBSOCKET_TLS_KEY_FILE` (paths to PEM files, empty by default). Both may be in the same file. A key with a passphrase cannot be used (the key is read with an empty passphrase, so that loading does not stop to ask on the console). Files over 1 MiB, anything that is not a regular file and empty files are not read.
- `/set/data/websocket_tls` takes `{"cert_file", "key_file"}` and saves them only when both can be loaded. Only one of the two, a request of a different shape or a pair that cannot be loaded gives `WEBSOCKET_TLS_INVALID`. Setting both to empty returns to the unset state, but while the host is not loopback this is refused with `WEBSOCKET_HOST_NEEDS_TLS`. A server running outside loopback is restarted with the new pair before the pair is saved. If it cannot restart, it is rebuilt with the previous pair and `WEBSOCKET_SERVER_UNAVAILABLE` is returned. The error's `data` is the saved pair.
- `/set/data/websocket_host` returns `WEBSOCKET_HOST_NEEDS_TLS` for an address other than loopback when no loadable certificate is set, and does not stop the server.
- The code that starts the servers (`Model.startWebSocketServer`, `Model.startObsBrowserSourceServer`) makes the same check. Outside loopback, if the certificate cannot be loaded, it returns a failure without listening. No path opens a plaintext listener on a LAN address.
- At startup, if the saved host is not loopback and the certificate cannot be loaded, the host is reset to `127.0.0.1` and saved. After the initial settings are passed to the UI, `WEBSOCKET_HOST_RESET_WITHOUT_TLS` (with `data` set to `127.0.0.1`) is sent on `/set/data/websocket_host`. A LAN address set in an earlier version is handled the same way.
- When a certificate cannot be read, the log records only the kind of reason (`missing`, `unreadable`, `not_a_file`, `size`, `load_failed`), never the path or the content of the file.
- For OBS over HTTPS, the TLS handshake runs on the thread that handles each request, and counts toward the 5-second deadline of the whole request. A connection that stalls its handshake does not block the acceptance of other connections. The WebSocket handshake deadline is 10 seconds.
- The URL the settings screen copies uses `ws://` and `http://` when the host is loopback, and `wss://` and `https://` otherwise. An OBS page served over HTTPS connects back over `wss://`.
- OBS and WebSocket share one token. The OBS page holds the WebSocket token to receive captions, so even with separate tokens, anyone who knows the OBS URL could read the conversation. If the token leaks, regenerating it invalidates both at once.

### Send limits

The limits are set by constants in `native/adapters/src/websocket.rs`. Conversation text is never truncated, and waiting messages are never dropped silently.

| Target | Limit and behavior |
|---|---|
| One message | 256 KiB in UTF-8 (`_MAX_OUTGOING_MESSAGE_SIZE`). A larger send is refused at intake with `BufferError` |
| All pending sends | 128 messages (`_MAX_PENDING_MESSAGES`) and 4 MiB in UTF-8 (`_MAX_PENDING_BYTES`). This includes callbacks waiting to run on the loop, the send queue and the one message being delivered. `send()` and `broadcast()` share the same budget. When it is full, `BufferError` is returned without waiting, and the conversation output code reports the failed WebSocket output with the existing `MESSAGE_OUTPUT_FAILED` |
| Send buffer per connection | 1 MiB (`_MAX_CLIENT_BUFFER_BYTES`). A connection that would go over the limit with the next message plus a 14-byte allowance for the frame header has its transport aborted before the write, which disconnects it. Compression is off. A client that keeps reading normally receives every accepted message, in order |
| Keepalive | A ping every 20 seconds (`_PING_INTERVAL`). 20 seconds from the start of sending the ping until the pong arrives (`_PING_TIMEOUT`), including the time spent waiting for the send buffer to drain; on timeout, the transport is aborted. The app does not wait for a close frame to finish sending |
| Number of connections | Up to 32 connections that are still opening, before the TLS and WebSocket opening steps and the token check (`MAX_OPENING_CONNECTIONS`). A connection beyond that is accepted and closed at once. Up to 64 connected clients (`MAX_CLIENTS`). A client beyond that is closed with 1013 (try again later) |

Delivery yields control back to the loop every 32 connections and after each message. Other connections never wait for a slow connection to drain. The limits above are on the application's buffers and intake, not on the OS socket buffers.

## OBS browser source

`native/adapters/src/obs/`. Serves the HTML that shows captions on a stream.

- `OBS_BROWSER_SOURCE` (off by default), `OBS_BROWSER_SOURCE_PORT` (default 2232, an integer from 1 to 65535). The listen address is the same as `WEBSOCKET_HOST`. Outside loopback, only HTTPS is used, with the same certificate as WebSocket ([Listening outside the local PC](#listening-outside-the-local-pc)).
- The numbers in the display settings must be integers. The maximum number of messages is 1 to 50, the display time 1 to 120 seconds, the fade-out time 0 to 120 seconds, the text size 10 to 200 px and the outline width 0 to 20 px. Over IPC, strings holding an integer are also accepted, and the success response and the broadcast notification return the saved integer. Values out of range, decimals and booleans are refused with the existing `OBS_BROWSER_SOURCE_*_INVALID`, and are neither saved nor broadcast. An invalid value in the saved file is reset to the default when the file is loaded. The first display and updates to open pages use the same ranges.
- Turning OBS and WebSocket on or off, and changing the host or port of either server, are processed one at a time under the [same IPC lock](ipc-protocol.md#並行性とロック). Turning WebSocket off turns OBS off too. Turning off OBS alone does not stop WebSocket.
- If enabling OBS fails, a WebSocket server started by that attempt is stopped. A WebSocket server that was already running is kept. If the WebSocket server that OBS depends on cannot start during enabling, `WEBSOCKET_SERVER_UNAVAILABLE` is returned; if the OBS port cannot be reserved, `OBS_BROWSER_SOURCE_PORT_UNAVAILABLE`; if OBS fails to start, `OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE`.
- Startup from the saved settings also checks whether OBS actually started. If it failed, OBS is turned off and any server reserved partway is stopped. After the initial settings are passed to the UI, the OBS error above is notified. A running WebSocket server is kept.
- On a WebSocket host change, an enabled OBS also starts listening on the new host before the setting is committed. If OBS fails to restart, both servers go back to the old host and `OBS_BROWSER_SOURCE_HOST_UNAVAILABLE` is returned. If WebSocket cannot be restored either, both are turned off; if only OBS cannot be restored, OBS is turned off.
- If a restart fails on an OBS port change, the app tries to recover on the old port and returns `OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE`. If it cannot recover, OBS is turned off. A port that is not an integer, or is outside 1 to 65535, gets `OBS_BROWSER_SOURCE_PORT_INVALID` before any setting or service changes. The value of a failed request and the release of the UI's wait follow [error handling](cross-cutting.md#エラーの扱い).
- `GET /` and `GET /obs` require `?token=<WEBSOCKET_AUTH_TOKEN>`. The token is compared with `hmac.compare_digest`; if it is missing or does not match, only a 403 with a short plain-text body is returned. No HTML or token is returned before authentication. Each request is checked against the current token, so the old token stops working right after regeneration.
- `GET /obs/connection` makes the same check with `Authorization: Bearer <WEBSOCKET_AUTH_TOKEN>` and returns only the current WebSocket port, as `{"wsPort": 整数}` (an integer). The token is not included in the response, and authentication by query string is not accepted. It uses the same Host validation and the same cache and referrer restrictions as the HTML.
- `GET /health` returns only `ok`, without authentication. Any other path gets 404. On every path, if `Host` is not an IP address or `localhost`, the response is 403 (protection against DNS rebinding).
- HTML responses carry `Cache-Control: no-store, max-age=0` and `Referrer-Policy: no-referrer`. No access log is written, and query strings are not recorded.
- The URL copied from the settings screen contains the same token as WebSocket. The screen shows it masked. An OBS browser source that is already set up also needs the URL copied again, and a note under the URL field says so.
- HTTP handles at most 16 requests at once, and connections beyond that are closed. Reading has a 5-second deadline, and so does the whole request; the deadlines are checked every 0.1 seconds and unfinished connections are closed. On shutdown, new intake stops, accepted connections are closed, and the app waits up to 2 seconds in total for the listener and each request to end. If work remains, the owner is kept, and the next start is not allowed until it ends.
- The page connects to the WebSocket server to receive captions. When the connection drops, it retries with a wait that starts at 0.5 seconds and grows 1.5 times each time, up to 8 seconds. Each time, it fetches the current port again from `/obs/connection`, so it can connect to a new port even if it missed the change notification. The re-fetch gives up after 5 seconds, and authentication failures, invalid responses and network failures are retried with the same wait.
- Display settings and their ranges: maximum number of messages 14 (1 to 50), display time 60 seconds (1 to 120), fade-out 12 seconds (0 to 120), text size 40 (10 to 200), text color `#FFFFFF`, outline 3 (0 to 20), outline color `#000000`.

## Cloud and network services

| Service | Endpoint | Authentication | When it is used |
|---|---|---|---|
| DeepL | `https://api.deepl.com` (`https://api-free.deepl.com` for a Free key) | API key | Key check and translation |
| Google Cloud Translation (Basic v2, core only) | `https://translation.googleapis.com/language/translate/v2` | API key (`x-goog-api-key` header) | Key check (`/languages`, which translates nothing) and translation (`format: "text"`) |
| Papago Translation (NAVER Cloud Platform, core only) | `https://papago.apigw.ntruss.com/nmt/v1/translation` | Client ID and Client Secret (`X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`) | Key check (sends an empty text and takes a 400 with `N2MT…` as passed authentication) and translation. Only language pairs it can translate directly are sent |
| Plamo | `https://api.platform.preferredai.jp/v1` | API key | Key check, model list and translation |
| Gemini | `https://generativelanguage.googleapis.com` (Developer API) | API key | Same as above |
| OpenAI | `https://api.openai.com/v1` | API key | Same as above |
| Groq (translation) | `https://api.groq.com/openai/v1` | API key | Same as above |
| OpenRouter | `https://openrouter.ai/api/v1` | API key | Same as above |
| OpenAI-compatible (translation) | `OPENAI_COMPATIBLE_URL` | API key | Same as above |
| LM Studio | `LMSTUDIO_URL` (default `http://127.0.0.1:1234/v1`) | None | Connection check, model list and translation |
| Ollama | `OLLAMA_URL` (default `http://localhost:11434`) | None | Same as above |
| Groq Whisper | `https://api.groq.com/openai/v1` | API key | Key check (`/models`) and `/audio/transcriptions` for each utterance |
| OpenAI Whisper | `https://api.openai.com/v1` | API key | Same as above. Requests use `json` for `*-transcribe` models and `verbose_json` for Whisper |
| Custom Whisper server | `TRANSCRIPTION_CUSTOM_URL` | API key (any string, even for a server that needs none) | Same as above |
| Deepgram | `https://api.deepgram.com/v1` | `Authorization: Token <キー>` (`<キー>` is the key) | Key check (`/auth/token`), model list (`/models`) and `/listen` for each utterance |
| Hugging Face | `https://huggingface.co/{repo}/resolve/{rev}/{path}` | None | Downloading models the user agreed to. Connections are limited to huggingface.co and its CDN |

- Conformance with each cloud speech recognition service's specification is checked against that service's official documentation.
- Google's web speech recognition from the Python version (which sent FLAC audio to an unofficial endpoint with the generic key of `speech_recognition`) is not used. The core has neither that endpoint nor that key.
- For OpenAI-compatible speech recognition, connecting and waiting for the connection pool time out after 10 seconds, and reading and writing the upload time out after 60 seconds. These limit how long communication can go without progress; they are not a deadline for the whole request including the SDK's retries.
- For automatic detection results from OpenAI-compatible services and Deepgram, the returned language name or code is matched against the selected languages and countries. Differences in letter case and between `_` and `-` are evened out, and candidates that match down to the region and script are preferred. If only the base language is known, the first candidate matching that language is used. If no language was detected, or it matches none of the selected candidates, the text is kept and `language` in the internal recognition result is set to `None`. In the conventional microphone and speaker recognition, the settings snapshot at delivery also keeps this unknown value, and the first candidate language is not attached as a guess. If the request specifies a language explicitly, that language is used.
- Even for a successful Deepgram response, unless it has the expected result structure, a string transcript and a finite confidence from 0 to 1, it is treated as `TRANSCRIPTION_API_SERVER_ERROR` and passed to the existing error path of the audio pipeline. An empty transcript in a correct structure is treated as an ordinary "no recognition result". Response bodies and secrets are not kept in the diagnostic log.
- No connection check is sent at startup (up to 0.4, a HEAD request went to `https://huggingface.co/` only when an automatic download at startup was planned; automatic downloading was retired in 0.5.0). The core sends `null` (not checked) on `/run/connected_network`. A boolean value is the result of a check against the download host. The UI shows a connection error only for `false`. This value alone does not make cloud engines and the like unavailable; that is decided by whether each request succeeds.
- The endpoints of official APIs are fixed in code. Changing the OpenAI or Gemini URL through environment variables, the LangSmith gateway and Ollama API keys are not used. Cloud HTTPS can use the system proxy. Authentication in Requests keeps the registered headers and does not replace them with netrc credentials. API connections to localhost and local IP addresses do not use a proxy. API redirects are not followed; only model downloads follow the existing allowlist of HTTPS hosts.
- For the allowed range of custom URLs and how they are handled when saved, see [network settings](data-and-persistence.md#ネットワーク設定).
- Update checks and downloads are done on the Rust side, by the Tauri updater ([App updates](#app-updates)).

### Usage data

The conditions for sending are in [cross-cutting behavior](cross-cutting.md#同意と外部への送信). The receiver belongs to ASTAROT (Cloudflare Workers) and is maintained outside this repository. Before changing the rules the receiver checks, agree on the change with the receiver's maintainers.

| Item | Details |
|---|---|
| Destination | `POST https://vrct-vox-telemetry.kei9d09.workers.dev/v1/events`. The endpoint is fixed in code |
| Key | The header `X-Ingest-Key`. A public value embedded in the app, with no permission beyond sending the two kinds of event |
| Body | `{"event": "app_started", "v": 2, "timestamp", "app_version", "os", "os_version", "locale", "hw"}`. `error` adds `error_code` (`[A-Za-z0-9_.-]{1,64}`) to this |
| `timestamp` | When the event was built. UTC in ISO 8601, to the second (`YYYY-MM-DDTHH:MM:SSZ`) |
| `hw` | `{"cpu", "cores", "ram_gb", "gpus": [{"name", "kind", "vram_gb", "driver"}]}`. Only the fields that could be read are included, and if nothing could be read, `hw` is left out entirely. Names are up to 64 printable ASCII characters. `ram_gb` is rounded to a common capacity step. `gpus` holds up to 4 GPUs. `kind` is `gpu` or `igpu`. `driver` is the display adapter's driver version from the registry on Windows, and only the NVIDIA driver version on Linux |
| `os` and `locale` | `os` is one of `Windows`, `Linux` and `Other`. `locale` is the display language as a tag: `ja-JP` for `ja`, and `en-US` for anything else |
| Response | `200 {"ok": true, "accepted": N}`. 401 without the key, 400 if the body is not JSON. Events that fail the checks are not counted in `accepted` |
| Transport | One POST per event. The timeout is 5 seconds. Redirects are not followed and no proxy is used. Nothing is resent after a failure |

- Events other than the two kinds, and error codes that do not match the format, are dropped before sending.
- The PC configuration is read from `speech devices --json` of the bundled speech.cpp (the same list as in [model download guidance](../voice-stack/model-downloads.md)). Startup does not wait for it; it is read once, before the first event.
- The deployed receiver also accepts events with fields it does not know (checked on 2026-11-14 with an `app_started` event carrying `v` and `hw`; the response was `accepted: 1`). Whether the receiver stores `hw` depends on the receiver's implementation.
- The environment variable `ASTAROT_TELEMETRY_URL` is for pointing to a substitute receiver that a developer runs on their own PC, and accepts only loopback HTTP addresses. Any other value is ignored.
- The receiver is designed not to store the sender's IP address or a device identifier (according to the receiver's maintainers). As the other end of the connection, Cloudflare handles the sender's address.
- For each event, the receiver records the time it was received and the country of the connection. The country is not a value the client sends; Cloudflare derives it from the connecting address (checked on 2026-11-14 in the receiver's read-only view). The explanation shown to users also covers these two.

### GPU report

Settings → "Advanced" → "GPU report" (decision 6 of #288). It is separate from usage data, and the app sends nothing. The core measures only when the user presses the button, and shows the result on screen. The user chooses whether to send it, and if so, sends it themselves as a GitHub issue.

| Item | Details |
|---|---|
| Starting | `/run/start_gpu_check` ("Run the check" in Settings). The answer is only `{state, run}`. One run at a time; a start while a run is in progress joins that run. `/run/stop_gpu_check` stops it |
| State | `/get/data/gpu_check_state` is `{state: idle\|running, run, step, outcome: done\|cancelled\|failed\|null, error_code, report, text}`. The UI reads it every second, only while a run is in progress. It is not in the startup list and is not written to the log |
| Measurement | Runs the bundled speech.cpp commands (`speech info`, `speech tts`, `speech asr`) with the configured text-to-speech model (`japanese` or `multilingual`) and speech recognition model (`asr`), on the CPU and on each GPU usable for compute (up to 4). Text to speech writes a fixed short sentence (Japanese or English) to a WAVE file in a temporary folder, and speech recognition transcribes, on each device, the audio from the first device that produced speech. It does not touch model downloads, the microphone, speakers or running servers. The temporary folder is deleted at the end |
| `report` | `{report: "astarot-gpu-check", schema: 1, app_version, os, os_version, hardware, speechcpp: {version, builds}, devices: [{device, kind, name, memory_gb}], busy, translation: {devices, measured: false}, tts, asr}`. `hardware` has the same shape as `hw` in usage data. `tts` and `asr` are `{model, language, runs}` or `{skipped: no_model\|no_audio\|no_voice\|unsupported_language\|model_unreadable}`. Each row of `runs` is `{device, ok, ran_on, load_s, audio_s, work_s, rtfx, first_audio_s, total_s, error}`, and speech recognition adds `cer_to_sentence`, the character error rate against the sentence, and `cer_to_cpu`, the character error rate against the CPU's text. `error` is a speech.cpp failure kind (such as `out_of_memory`), `timed_out`, `cancelled` or `exit_<コード>` (`<コード>` is the exit code) |
| Left out | File locations, the user name, the PC name, the sentence read aloud and the text heard, audio and messages printed by speech.cpp. For models, only the name the file carries and the quantization type (up to 64 ASCII characters) |
| `text` | `report` formatted as JSON. The full text is shown on screen, and copying and the issue use this string as is |
| Sending | "Report on GitHub" opens a URL carrying the issue form `gpu_report.yml` as `template`, a title and the value of the `report` field (the opener allows `https://github.com/kein5/astarot/**`), and also copies the same content to the clipboard. If the URL would be longer than 7000 characters, it opens without `report`, and the user pastes it |

### Turning off ONNX Runtime telemetry

The bundled ONNX Runtime (chat reading, local translation and the voice conversion worker) always has the usage data sending of Microsoft's official builds turned off, whatever the app's consent setting is (#518).

- The app (`run` in `src-tauri/src/lib.rs`) and each tool that loads ONNX Runtime (`ocr-read`, `astarot-translate`, `astarot-rvc-worker` and others) set the environment variable `ORT_DISABLE_TELEMETRY=1` before starting any other thread. The voice conversion worker inherits this value from the app.
- Every ONNX Runtime environment is created with `with_telemetry(false)` (`DisableTelemetryEvents`).
- The Linux build (1.31) creates `deviceid` and an event database in `~/.cache/Microsoft/DeveloperTools/.onnxruntime/` when an environment is created, and sends to `mobile.events.data.microsoft.com`. Only the environment variable can stop this. `DisableTelemetryEvents` is called after the environment is created, so it comes too late for the first event and the files (checked on 2026-11-17 with the official `onnxruntime-linux-x64-1.31.0.tgz`).
- The Windows build (1.31) does not send over HTTP. It only writes ETW events (provider `Microsoft.ML.ONNXRuntime`) and does not create the `deviceid` file. Whether the events are collected depends on the Windows diagnostic data setting. It does not read the environment variable and is stopped by `DisableTelemetryEvents`. Only the first `ProcessInfo` event, written when the environment is created, comes before this setting.
- Tests: `tests/voice/test_onnx_runtime_telemetry.py` checks the places that create environments and the first statement of each executable's `main`.

### WebView2 network traffic

The WebView2 Runtime, which draws the screens on Windows, communicates with Microsoft independently of the app's screens. The app's consent setting does not stop it.

According to Microsoft's documentation ([Data and privacy in WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy)), it is handled as follows.

- Optional diagnostic data follows "Diagnostic data" under "Diagnostics & feedback" in Windows "Settings" → "Privacy & security". Required diagnostic data is collected regardless of this setting. The app has no way to stop it all.
- The app can change only SmartScreen (`IsReputationCheckingRequired`) and the sending of crash dumps (`IsCustomCrashReportingEnabled`). Both are APIs; there is no environment variable for either.
- The environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is appended after the launch arguments the app passes ([CreateCoreWebView2EnvironmentWithOptions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions)). No flag that stops telemetry is in the official list of flags ([WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)). That list also asks apps that are distributed not to use the flags.

These are the results of running the 0.5.0 Windows build (WebView2 Runtime 158.0.4370.26) for 150 seconds with an empty WebView2 data folder and capturing the WebView2 net log (`--log-net-log`) (2026-11-17). Text input and audio were not used.

| Destination | Content | With `--disable-background-networking` |
|---|---|---|
| `config.edge.skype.com` | Fetching Edge experiments and configuration (`/config/v1/Edge/<版>`, where `<版>` is the version) | Gone |
| `edge.microsoft.com/componentupdater` and `msedge.b.tlu.dl.delivery.mp.microsoft.com` | Checking for and downloading component updates | 36 checks and 8 downloads drop to 4 checks and 1 download right after startup |
| `nav-edge`, `data-edge`, `telem-edge` (`.smartscreen.microsoft.com`) | SmartScreen checks and their reporting | Remain (not stopped, per SEC-03) |
| `wpad` | Proxy auto-detection | Remains |

- `--disable-background-networking` is put in the launch arguments of every window (`BROWSER_ARGS`) to stop the first two above. It is a Chromium switch that is not in the official WebView2 list, so a Runtime update may make it stop working. It is a stopgap; when the Runtime version goes up by a large step, check it again the same way.
- It goes into the launch arguments rather than an environment variable because an environment variable is also inherited by the sidecar and other programs the app starts. From WebView2's side, both end up as the same sequence of launch arguments. If the user has set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, it is appended after them.
- Windows diagnostic data (what the WebView2 documentation calls Windows data reporting) is outside this measure. It does not appear in the net log and follows the Windows setting.
- Crash dumps are not sent (#564). The app creates the WebView2 environment that all windows share (`src-tauri/src/webview_environment.rs`) and turns `IsCustomCrashReportingEnabled` on. WebView2 then does not send crash records to Microsoft and leaves them in the user data folder. The app neither reads nor sends those records.
  - The contents of the environment match what Tauri and wry (0.57) create: the user data folder (`app_local_data_dir`), the launch arguments (`BROWSER_ARGS`), the language (the user's UI language), extensions off and default scrollbars. The crash dump setting is added to this.
  - All windows use this one environment. If an environment with different settings is created on the same user data folder, WebView2 does not create that window. So windows are created only through `webview_environment::window` and `webview_environment::main_window` (a test confirms that Tauri's builder is not used directly anywhere else). `main` is set to `"create": false` in `tauri.conf.json` and is created in `setup` after the environment is created.
  - If the environment cannot be created, the reason is written to the startup log, and each window opens in the environment Tauri creates (as before this change). Crash dump sending then follows the Windows setting.

### App updates

Updates use the Tauri updater (`tauri-plugin-updater`) (`src-tauri/src/app_update.rs`, #330). The UI uses only the `app_update_*` commands ([Tauri commands](#tauri-commands)), and no window is given permission for the updater plugin's own commands.

| How it was installed | How it is detected | What updating can do (`mode`) |
|---|---|---|
| Windows installer | `uninstall.exe` is next to the executable | Check and install (`install`). Starts the installer with `/P /UPDATE /R /ARGS …`, and the app exits. Apps up to 0.5 also pass `/EDITION=cpu` or `/EDITION=gpu`, but the installer downloads the one ZIP either way (`ASTAROT.zip` from 0.7.0, `VRCT-VOX.zip` up to 0.6.x) (#288) |
| Windows ZIP | None of the above | Check and notify only (`manual`) |
| AppImage | `APPIMAGE` is set and its folder is writable | Check and install (`install`). Replaces the AppImage and restarts |
| AppImage in a location that cannot be written | The folder of `APPIMAGE` is not writable | `manual` |
| Linux tar.gz | None of the above | `manual` |
| deb, rpm | `package-manager` is next to the executable (placed by `tools/linux_packages.py`) | No check (`package_manager`) |
| Development build | Debug build | No check (`disabled`) |

- The update information is `latest.json` from the GitHub releases. A stable version (no `-beta` in the version) reads `https://vrct-vox-updates.kei9d09.workers.dev/latest.json`. This endpoint is the project's Cloudflare Worker, which forwards to the latest release (`https://github.com/kein5/astarot/releases/latest/download/latest.json`). A prerelease never becomes "latest". A beta version reads `/beta/latest.json` from the same Worker and, if that cannot be fetched, the stable `latest.json` (the updater tries the next endpoint on a failure status code or a network failure). The Worker forwards this to `beta/latest.json` on this repository's branch `updater-channels` (`raw.githubusercontent.com`). Each time a release is published, a workflow (`.github/workflows/update-channels.yml`, `tools/update_channels.py`) rewrites this file with the `latest.json` of the newest version, beta or stable, among the non-draft releases that have a `latest.json`. It does not write a file whose version does not belong to that release, or whose files are not that release's downloads (#466). The app does not call the GitHub API to check for beta versions. Neither request is authenticated, and the only headers are the updater's defaults and User-Agent.
- Update channel (#466): how "stable version" and "beta version" above are read follows `SELECTED_RELEASE_CHANNEL` (`stable` or `beta`). If the user has not chosen yet, it is decided at every startup from the running version (`beta` if the version contains `-beta` or `-rc`). Choosing it on the Experimental page of Settings (`/set/data/release_channel`) sets `RELEASE_CHANNEL_CHOSEN` to `true` and keeps that value for later startups. With Beta, prereleases are candidates even from a stable version. The updater only offers versions newer than the current one, so going back to Stable while on a beta does not install an older version; the app updates when the next stable release is out. The check on the Updater page passes the channel in `channel` of `app_update_check`, and for the backend's update endpoints, the core passes this setting. Check results are shared only between checks of the same channel. When the channel changes, the version found on the previous channel is cleared from the screen and the new channel is checked at once (even if the startup check is off, because this check answers a change the user made; nothing happens while a download or install is in progress). `app_update_check` accepts only one call at a time (a second gets `update_busy`), so if the channel changes during a check, the app waits for that check to finish, then checks the new channel, showing "Checking for updates…" meanwhile. The result of the check that was in progress belongs to the previous channel and is not shown. After several changes in a row, only the last chosen channel is checked. This way, the version shown on screen and the install target (the version `app_update_check` found last) always belong to the last chosen channel (`src-ui/logics/common/appUpdate.ts`). The Tauri side enforces the same rule on its own, apart from the screen (#1017). As soon as `app_update_check` asks about a different channel from the previous one, the version found on the previous channel is removed from the install target, even if that check is refused with `update_busy` or fails. The version from a check that finished after a different channel was asked about does not become the install target. "(beta)" next to the version on the Updater page shows the channel of the running version (`channel` of `app_update_info`).
- `platforms` in `latest.json` has `windows-x86_64` (`ASTAROT_setup.exe`) and `linux-x86_64` (`ASTAROT-<version>-linux-x64-release.AppImage`). Up to 0.6.x these were `VRCT-VOX_setup.exe` and `VRCT-VOX-<version>-linux-x64-release.AppImage`. Each 0.7.x release carries every distributable together with copies under the names used up to 0.6.x, but `latest.json` does not point to the copies (section 2.10 of ADR-014, [release candidate procedure](../voice-stack/release-candidates.md#旧名の写し)). Apps of 0.6.x also download from the URL written in `latest.json`, so they can update even though the names changed. The workflow that creates the draft (`prepare-release.yml`) signs the verified candidates with `tauri signer sign --app-version` and writes the file with `tools/updater_manifest.py`.
- A downloaded file is verified with the public key in `tauri.conf.json` (minisign, key ID `1178836E5C9F510B`), and the version in the trusted comment of the signature must also match the version in `latest.json` (`requireSignedVersion`). If it does not match, the update is not installed.
- With `/UPDATE`, the installer skips the language page, does not write `installer_language.txt` and does not recreate shortcuts. Downloading the ZIP, checking its SHA-256 and replacing files in stages are the same as in a normal install ([release candidate procedure](../voice-stack/release-candidates.md)). From 0.7.0, the installer moves an installation in the default install location of 0.5.0 or earlier to `%LOCALAPPDATA%\ASTAROT` after updating. The same applies with `/UPDATE`, and `/R` starts the executable in the new location ([Moving the Windows install location](data-and-persistence.md#windowsのインストール先の移動)). From 0.7.0, the main executable is `astarot.exe`; the installer replaces the `vrct-vox.exe` of 0.6.x and earlier and starts `astarot.exe` with `/R` ([Name of the main executable](data-and-persistence.md#本体の実行ファイルの名前)).
- Only one installer runs at a time in the user's session. If an installer started by an app update and one the user opened overlap, the one started later reports that another installer is running, changes nothing and exits with exit code 2. The report goes to the console that started it when the installer is silent (`/S`), and appears as a message otherwise (including `/P`). Downloaded files are put in a folder created for each run inside `%TEMP%`, and the folder is deleted at the end ([release candidate procedure](../voice-stack/release-candidates.md#windowsのwebview2とインストール時の通信)).
- The startup log (`startup_log`) records only the kind of failure and the URL. Updating does not handle conversations or audio.
- The backend's update endpoints use the same updater (`backend_host.rs` passes `CoreUpdates` from `app_update.rs` to the core; [decision 20](../voice-stack/core-integration.md#判断が要ること)).
  - `/get/data/available_releases` returns, from the list of GitHub releases above (the newest 30), the releases the update channel takes, newest first, as `[{tag, version, is_prerelease, published_at}]`. Stable takes stable releases only; Beta takes both. Drafts, tags that are not versions, releases without `latest.json` and releases whose downloads are not this repository's are left out. Copies that do not check (deb, rpm, development builds) return an empty list without network access.
  - `/run/software_update_info` at startup (`{is_update_available, new_version}`) checks with the updater only when `CHECK_SOFTWARE_UPDATES` is on. When it is off, "no update" is sent without network access. This check runs at the same time as the Updater page's check, so a check in progress, and a successful result from within 30 seconds after a check finished, are shared. When the channel is changed to a different value (`/set/data/release_channel`), the core checks the new channel the same way and sends the result. When the setting is off, "no update" is sent again without network access. If a check of the previous channel finishes after the change, its result is not sent. This way, the last `/run/software_update_info` sent always belongs to the current channel (#1017).
  - `/run/update_software` and `/run/update_cuda_software` download the latest version of the update channel, or the version in `data` (one from the list), verify the signature and install it. There is only one distributable, so the two endpoints behave the same (`/run/update_cuda_software` remains as part of the IPC contract; the UI uses only `/run/update_software`). A copy whose `mode` is not `install` does not install. A signature failure gives `UPDATE_SOFTWARE_VERIFY` and any other failure `UPDATE_SOFTWARE_DOWNLOAD`, and the current version keeps running.

### Translation with LLMs

Plamo, Gemini, OpenAI, Groq, OpenRouter, OpenAI-compatible, LM Studio and Ollama send the text currently being translated, the language settings, the prompt and recent conversation history to the endpoint. The prompt also contains the system instructions and the supported languages. The core calls the APIs directly without each vendor's SDK, and sends no information about the runtime environment apart from the header `User-Agent: ASTAROT` (`native/translation/src/http.rs`; up to 0.4, in Python, the SDKs sent such things as the OS and library versions). For LM Studio and OpenAI-compatible, the configured URL is the destination, and for OpenRouter, the provider of the chosen model also gets the request.

The history uses chat, microphone and speaker messages. Up to the 5 most recent are included, with their time and input source, and the formatted history is limited to 4,000 characters. Past OCR history is not included, but if the text being translated now is OCR text, it is sent. These are set by constants in the core's `native/translation/src/prompt.rs` (`HISTORY_SOURCES`, `HISTORY_MAX_MESSAGES`, `HISTORY_MAX_CHARS`), and there is no UI switch for the history alone (up to 0.4, the same values were set in the prompt file in `src-python`). DeepL and CTranslate2 do not send this history.

The user can set two things to ask of these engines besides the text ("More settings" on the Translation page of Settings, #392). Both are empty by default, and when they are empty, the same request as up to 0.4 is sent.

- Temperature (`LLM_TRANSLATION_TEMPERATURE`): a decimal from 0 to 2 (up to 2 decimal places), saved as a string. It is sent only when set: as `temperature` for chat-style APIs, `generationConfig.temperature` for Gemini and `options.temperature` for Ollama. When it is empty, nothing is sent (Gemini sends 0.7 as before). If a request with a temperature is refused with 400, it is sent again once without the temperature (OpenAI's reasoning models do not accept a temperature other than the default). It is not added for models that only support the Responses API.
- Extra instructions (`LLM_TRANSLATION_INSTRUCTIONS`): a single line of up to 500 characters with no control characters. It goes after the system prompt's rule (return only the translation) and before the term dictionary and the conversation history, with a note to follow it as long as that does not change the rule. The instructions are sent to the destination but are not written to `process.log`.

The local TranslateGemma (llama.cpp) runs with the format from the model card and greedy decoding (temperature 0), so it uses neither.

The translation history keeps up to 20 messages in memory and carries over only while the same destination stays in use. Following [consent and external sending](cross-cutting.md#同意と外部への送信), changing the engine, URL or model moves the history to a new generation. Turning translation on or off, and changing the tab, the translation API key, the CTranslate2 weights, or the URL or model of an engine that is not selected, also invalidates it, to avoid sending to the wrong destination. Saving the same value again does not invalidate it. There is no step that rolls the generation back, so switching the destination away and back again does not reuse the old history.

Each message keeps the generation from when it was accepted, and if the settings change during processing, it skips using and adding to the history. Each request fixes its history and client references, and passes an empty history explicitly as well. A request that has already started may keep sending to the previous destination. Changing the settings cannot take back what has already been sent. Invalidating the history affects only the temporary buffer for translation, and does not change the conversation log on screen or in files.

## Local speech servers

| Counterpart | Startup | Communication |
|---|---|---|
| Bundled speech.cpp (TTS, ASR) | `build/speechcpp/speech serve …` (`build/speechcpp-cpu` for the Linux CPU build). The core starts it directly, and on Linux the child process ends when the thread that started it ends (`PR_SET_PDEATHSIG` in `native/speech-server/src/child.rs`). The profiles are `japanese`, `multilingual` and `asr` | A port on `127.0.0.1` assigned by the OS. Readiness is checked with `GET /health` and `GET /v1/models`. The startup wait is 120 seconds |
| External speech.cpp | Started by the user | Only loopback `http` is accepted |
| Text to speech | — | `POST /v1/audio/speech` with `{input, voice, language, response_format: "pcm", seed?, instructions?}`. The response is `audio/pcm`. Up to 4000 characters |
| Speech recognition (REST) | — | `POST /v1/audio/transcriptions` |
| Real-time speech recognition | — | `ws://…/v1/realtime`. `session.update` and `input_audio_buffer.append`, `commit` and `clear` |
| Speaker diarization (optional) | If the `asr` profile has a path to a diarization model, the same server is made to load it as a third model | Only the speaker audio connection to a server whose `/v1/models` returns `diarization` on a device other than the CPU puts `{}` in `audio.input.diarization` of `session.update`. It receives `speakers` (label, start, end) for finalized utterances. The microphone connection does not request it |
| RVC worker | `build/astarot-rvc-worker` (Rust, `native/rvc-runtime`). The core starts it directly (`native/voice-conversion/src/child.rs`) | PCM over stdin and stdout (48 kHz, in blocks of the length `--block-ms` sets. The core passes `RVC_BLOCK_MS`; with the default 0 (automatic), it passes `--block-ms auto`, and the worker picks a length the GPU can keep up with. Without the option, the worker uses 80 ms, 3840 frames. `block_frames` in `ready` returns the length). Control messages are JSON lines (up to 32 KiB). The ONNX Runtime and CUDA libraries are loaded from `lib/` in the runtime folder. If the GPU cannot be used, conversion runs on the CPU. `ready` reports where conversion runs (the GPU if `profile` is `low`, the CPU if it is `cpu`) and the latency it adds (`latency_ms`). When the CPU cannot keep up, the worker sends `failed` (`vc_capture_overrun`) instead of output and stops |

Stops and crashes of the bundled TTS server are handled by matching the identifier of each launch with the generation of TTS that uses that run. When the server that the current TTS uses exits, TTS is turned off, waiting and playing speech is cancelled, and the UI learns of it through the voice status fetch as before. Even if notifications overlap right after a stop of the same run and after its cleanup, TTS is disabled and its generation advanced only once. A late notification from an old run does not turn off TTS that uses a different endpoint or a newer server run.

The bundled speech.cpp is only the Vulkan build in `_internal/build/speechcpp` on Windows, and on Linux it is two builds: the Vulkan build in the same place and the CPU build in `_internal/build/speechcpp-cpu`. At every launch, the inference device in the settings decides which one is used. `cpu` uses the CPU build (on Windows, the same Vulkan build with `--device cpu`), `gpu` and GPU names use the Vulkan build, and `auto` uses the Vulkan build if its `speech devices --json` runs and shows a GPU usable for compute, and the CPU build otherwise. When `auto` ran on the CPU build because the Vulkan build did not start (no `libvulkan.so.1`), `notice: "speech_server_cpu_fallback"` is added to that profile in `/get/data/speech_server_state`. `/get/data/speech_server_devices` returns, besides the GPU rows (`devices`), what runs the CPU (`cpu_build`: `separate`, `shared`, `missing`) and whether the GPU choices can start (`gpu_build`: `ready`, `unavailable`, `missing`). The details are under "Decided" in the "Decisions needed" section of [core integration](../voice-stack/core-integration.md).

The bundled ASR server always loads the recognition model and the VAD model, and loads the diarization model only when the settings have a path for it. The startup check compares the contents of `/v1/models` with the settings. If a diarization model was specified but the server does not have it, or none was specified but the server has one, startup fails with `speech_server_model_tasks`.

The bundled ASR server also matches the identifier of each launch with the capture generation of the microphone and of the speaker. Only a capture that uses the run that ended is stopped, and the same exit notification is not processed twice. A notification from an old run does not stop a new capture. When a capture stopped because of a crash, the cause is reported as before.

Turning the TTS switch off stops only the bundled server that this switch started. A server started from the settings screen and the independent RVC switch are kept.

The design history is in the ADRs in [`docs/adr/`](../adr/README.md).

### Speech synthesis engines installed by the user

Japanese text to speech can also use an engine that the user installed and started ([ADR-008](../adr/adr-008-external-speech-engines.md)). The app does not bundle these engines, and neither installs nor starts them. The endpoint must be loopback `http`, which `local_url()` checks. Languages other than Japanese are read with speech.cpp as before.

| Engine | Default URL | APIs used |
|---|---|---|
| VOICEVOX, SHAREVOX, AivisSpeech | 50021, 50025 and 10101 on `127.0.0.1` | `GET /version`, `GET /speakers`, `POST /audio_query`, `POST /synthesis` (`native/tts/src/engines.rs`) |
| COEIROINK v2 | `127.0.0.1:50032` | `GET /v1/engine_info`, `GET /v1/speakers_path_variant`, `POST /v1/synthesis` (`native/tts/src/engines.rs`) |

- The text is split at sentence ends (`。`, `！`, `？` and so on) and line breaks, and a sentence over 40 characters is also split at Japanese commas. Sentences are synthesized one at a time, and the next one is synthesized while the current one is read (`native/tts/src/engines.rs`). The engines return a whole WAV for each sentence, so without splitting, microphone text to speech would miss its 5-second start deadline.
- For VOICEVOX-type engines, the `/audio_query` response is passed to `/synthesis`. Only the Scale values changed from their defaults in the table below are rewritten (section 5.2 of ADR-008), because AivisSpeech may refuse a query whose other parts were rewritten. If all four are at their defaults, the response bytes are passed as they are. COEIROINK's speaker list uses `/v1/speakers_path_variant`, which has no images. `/v1/speakers` includes images in base64, about 1 MB for a single speaker.
- The chosen voice is saved as the engine's ID (`speakerUuid:styleId` for COEIROINK), the speaker name and the style name. If the ID is not found, or the name of the voice with that ID has changed, the voice is looked up again by name. If it is still not found, the request fails with `tts_engine_voice_missing`; if no voice is chosen, with `tts_engine_voice_unset`; if the engine cannot be reached, with `tts_engine_not_ready`. Styles for singing are not listed.
- COEIROINK's `/v1/synthesis` receives 7 values from the voice settings (`VOICE_SETTINGS`). The values are saved as decimal strings, and values out of range or written like `1e0` are not saved.

  | Setting | Field sent | Range | Default |
  |---|---|---|---|
  | `coeiroink_speed` | `speedScale` | 0.5 to 2 | `1.0` |
  | `coeiroink_volume` | `volumeScale` | 0 to 2 | `1.0` |
  | `coeiroink_pitch` | `pitchScale` | −0.15 to 0.15 | `0.0` |
  | `coeiroink_intonation` | `intonationScale` | 0 to 2 | `1.0` |
  | `coeiroink_pre_phoneme` | `prePhonemeLength` (seconds) | 0 to 1.5 | `0.1` |
  | `coeiroink_post_phoneme` | `postPhonemeLength` (seconds) | 0 to 1.5 | `0.1` |
  | `coeiroink_sampling_rate` | `outputSamplingRate` (Hz) | 16000, 24000, 44100, 48000 | `24000` |

  The defaults are the values that were sent as fixed values before these became configurable. Old settings without these keys are read with the defaults. On the settings screen, the 7 values appear under "How COEIROINK reads" only when COEIROINK is chosen. Saved values are used from the next utterance. They are not used for VOICEVOX-type engines.
- The reading settings of VOICEVOX, AivisSpeech and SHAREVOX are held in the voice settings (`VOICE_SETTINGS`), 4 for each engine (`<エンジン>` is `voicevox`, `aivis` or `sharevox`). The values are saved as decimal strings, and values out of range or written like `1e0` are not saved (#392).

  | Setting | Field rewritten | Range | Default |
  |---|---|---|---|
  | `<エンジン>_speed` | `speedScale` | 0.5 to 2 | `1.0` |
  | `<エンジン>_volume` | `volumeScale` | 0 to 2 | `1.0` |
  | `<エンジン>_pitch` | `pitchScale` | −0.15 to 0.15 | `0.0` |
  | `<エンジン>_intonation` | `intonationScale` | 0 to 2 | `1.0` |

  The defaults are the values that VOICEVOX's `/audio_query` returns, and fields left at their defaults are not rewritten. The ranges are the adjustment ranges in VOICEVOX's own UI. On the settings screen, the 4 values appear under "How *engine name* reads" for the chosen engine. Saved values are used from the next utterance. Fields left at their defaults are not written to `config.json`. Version 0.5 discards the whole `VOICE_SETTINGS` when it has fields that 0.5 does not know, so if nothing was changed, the voice settings survive a return to 0.5.
- Only 16-bit PCM WAV is accepted, and it is streamed in pieces of about 0.2 seconds. One utterance is at most 60 seconds. Errors use only safe codes and do not include the text being read, the audio or the response body.
- The settings screen (`src-ui/.../tts/TtsEngine.tsx`) sends `{engine, url, request_id}` to `/get/data/tts_engine_voices` when an engine is chosen and when "Check again" is pressed. It uses the engine and URL being edited, before saving, and asks the engine only for its version and its list of voices. It sends no text and synthesizes nothing. The response is used on screen only when its `request_id` matches the latest query. Up to 500 voices are returned, and voices whose names or IDs cannot be saved are left out.
- The external engine cards in the model catalog (`EngineCatalog.tsx`) also check whether they can connect, through the same endpoint. They use the saved URL (the engine's default if none is set), with a `request_id` starting with `catalog-`. Results are kept per engine and do not replace the query of the section above. They query once when the saved settings arrive, and again when "Check again" is pressed.

## Desktop integration

### App windows

| Label | Entry point | Content |
|---|---|---|
| `main` | `src-ui/index.html` | The main screen and the settings screen. Closing it quits the app |
| `quick_chat` | `src-ui/quick-chat.html` | The small chat input window. A hotkey or a button opens it; closing it only hides it, and the draft remains |
| `vr_panel` | `src-ui/vr.html` | The VR UI. Drawn off screen at (-10000, -10000), and the overlay captures it. Created only while the VR UI is on |
| `caption_overlay` | `src-ui/caption-overlay.html` | The desktop captions. Placed topmost, passes clicks through and takes no focus. Receives the mouse only while Ctrl is held ([desktop captions](use-cases.md)). Created only while the captions or the inputs and outputs display is on |

The settings screen is not a separate window but a page inside `main`.

On Windows, WebView2 creates every window with the same launch arguments (`main` in `src-tauri/tauri.conf.json` and `BROWSER_ARGS` in `src-tauri/src/lib.rs`; a test confirms they are the same). All windows share one WebView2 environment that the app creates ([WebView2 network traffic](#webview2-network-traffic)). `msSmartScreenProtection` is removed from Tauri's default `--disable-features`, so SmartScreen works as it does by default (second security audit SEC-03). The features that stop rendering hidden windows (`CalculateNativeWinOcclusion` and stopping rendering in the background) are disabled, because the VR panel is placed off screen and captured. Traffic to Microsoft that has nothing to do with the screens is reduced with `--disable-background-networking` ([WebView2 network traffic](#webview2-network-traffic)).

### Webview Content Security Policy (CSP)

`app.security.csp` in `src-tauri/tauri.conf.json` applies to the distributed HTML of all three windows above. It uses the directive map format from `node_modules/@tauri-apps/cli/config.schema.json` of Tauri CLI 2.12.4 (Tauri 2.12.5 on the Rust side). It allows resources that the browser engine loads; it does not replace Rust/Python networking or Tauri capabilities.

| Directive | Allowed sources | Reason |
|---|---|---|
| `default-src`, `script-src` | `'self'` | Same-origin JS that Vite generates, shared chunks and modulepreload. i18next and js-yaml process the bundled translation data. eval, the Function constructor and Wasm are not used |
| `style-src` | `'self'` and the 2 SHA-256 hashes below | Only the CSS vanilla-extract generates and the fixed `<style>` elements that dependencies insert at run time |
| `style-src-attr` | `'none'` | HTML style attributes and `setAttribute("style", …)` are not allowed. React's `style` prop, virtua, the color picker and the updates to scale, font and OCR region use CSSOM property assignment |
| `img-src` | `'self' data:` | Bundled PNG/SVG, small images that Vite inlines, and data SVGs for select boxes and react-colorful. SVG imports with `?react` become elements in JS |
| `font-src` | `'self'` | The selected fonts on the OS and the Noto/system fallbacks. Currently there is no font file fetch and no `@font-face`. Remote fonts are not used |
| `connect-src` | `'self' ipc: http://ipc.localhost https://ipc.localhost` | Same-origin modulepreload fetches and Tauri IPC, including the HTTP/HTTPS forms used on Windows. Plugin commands go through the same IPC |
| `media-src`, `worker-src`, `frame-src`, `object-src` | `'none'` | The UI has no audio or video player, Worker, iframe or object |
| `base-uri` | `'self'` | Forbids changing the base URL to another origin |
| `frame-ancestors`, `form-action` | `'none'` | Forbids embedding and submission through HTML forms |

The fixed values added to `style-src` are `'sha256-I2px+fnpbN4E5+Djrj7aoTIyq9yyREkuVl19f4Sye9A='` for react-colorful 5.8.1 and `'sha256-wBAOjWqzlHdwhuIyV//yRl4v0VNTHc3TOqbIfNXoA7k='` for react-toastify 11.2.0. They are computed from the UTF-8 bytes of the CSS strings the dependencies actually insert. `'unsafe-inline'`, `'unsafe-eval'` and `'wasm-unsafe-eval'` are not allowed for distribution. When a dependency update changes a string, check how it is inserted and the URLs in the CSS, then update the hash.

`dangerousDisableAssetCspModification` keeps its default, `false`. Tauri's insertion of nonces and hashes into the HTML is not disabled. Nor is `script-src-elem` specified separately in a way that disables Tauri's additions to `script-src`. `freezePrototype` is a separate protection against prototype pollution, not a condition for enabling CSP. This time it keeps its default, `false`.

The backend (the Rust core) runs inside the app and connects to the UI through Tauri commands and channels (up to 0.4, a Python sidecar was connected through the shell plugin's stdin/stdout). The UI does not connect directly to the core's HTTP server, OBS, the WebSocket for conversation streaming or the speech servers, so their hosts and ports are not added to `connect-src`. The OBS URL is a string to copy, and its page is not shown inside Tauri. Model downloads are run by the core (`native/ops`) after consent (up to 0.4, by the Python side). External links for model cards, licenses and About open through the opener. The core writes the logs. The OCR region preview is a CSS rectangle and does not load screen capture images. Allowing `blob:`, `asset:` and `http://asset.localhost` is not needed, and the asset protocol stays disabled.

Only `devCsp` allows the inline script for Vite's React Refresh, the styles for HMR, and `ws://localhost:1420`, `ws://127.0.0.1:1420`, `ws://localhost:1421` and `ws://127.0.0.1:1421`. The usual dev URL is `http://localhost:1420`. To specify another host in `TAURI_DEV_HOST`, write that host's HMR URL (port 1421) in `devCsp.connect-src` of a local Tauri configuration for development. Do not widen the distribution CSP.

The static checks are in `src-ui/logics/common/contentSecurityPolicy.test.ts`. They check the configuration, dangerous calls and resource loads in the source, and the CSS hashes of the dependencies. If `dist/` exists, they also confirm that the generated JS has no eval, Wasm or Worker, that the generated CSS and HTML refer only to bundled resources, and that the CSS inside the generated JS has the same hashes. Without `dist/`, only the checks of the generated output are skipped, so also run the test on its own after a Vite build. The static checks do not prove the data flow of arbitrary dynamic URLs or the behavior of the webview implementation. Run [CSP verification in a distribution build](../readme_build.md#配布ビルドでのcsp検証) separately.

### Tauri commands

| Command | Windows that can call it | What it does |
|---|---|---|
| `get_font_list` | `main` | The list of system font names |
| `vr_panel_send` | `vr_panel` | Sends notices from the VR panel to `main` (`vr-panel-ready`, `vr-panel-config-page`, `vr-panel-stdout`). It checks that the caller is `vr_panel`, that the event name is one of these 3 and the shape of the payload (`null`, a boolean, or an object whose `path` is a string), and returns `vr_panel_state_forbidden` or `vr_panel_event_invalid` if they do not match. The VR panel has no permission to emit events, so it cannot pose as events that Rust or another window sends. On Linux, the window that is created is not shown; the page inside it is moved to a place that does not appear on the desktop and handed to the backend ([Handing over the VR screen](use-cases.md)) |
| `main_window_restore` | `main` | Restores the minimized main screen and brings it to the front. On Wayland the app cannot know the minimized state, and a portal hotkey has no right to bring a window to the front, so the UI remembers that it minimized the window and asks KWin when restoring it |
| `quick_chat_show`, `quick_chat_configure`, `quick_chat_take`, `quick_chat_finish`, `quick_chat_shortcut_platform` | `main` | Opens the small window, passes the settings, takes send requests, returns results, finds out how hotkeys are registered |
| `quick_chat_context`, `quick_chat_submit`, `quick_chat_hide` | `quick_chat` | Reads the settings, asks for a send, hides the window |
| `portal_shortcuts_bind` | `main` | Registers hotkeys on Wayland (gives up after 180 seconds). It closes the current session before registering again, so when it ends with a cancel on the confirmation dialog, a timeout or a failure, it returns an error and then registers again the set that was in effect just before. If a newer registration request has come in, it does not register again |
| `screencast_support` | `main` | `{supported, active}`: whether the desktop can share windows (a Wayland session on Linux), and whether sharing is active now. Starts nothing |
| `screencast_start` | `main` | Asks the desktop to share a window ([Window sharing](#window-sharing-linux)). The argument is the saved `restoreToken` (`null` if there is none). On success it returns `{restore_token}`. Called while sharing, it ends the previous share before asking. The wait for the selection dialog is 180 seconds |
| `screencast_stop` | `main` | Ends sharing, stops the helper and closes the portal session |
| `app_update_info` | `main` | `{kind, mode, channel, current_version, package_manager}`: how this copy was installed and what updating can do ([App updates](#app-updates)). No network access |
| `app_update_check` | `main` | Asks for a new version and returns `{available, version, release_url}`. Failures are codes such as `update_check_failed` and `update_metadata_missing` |
| `app_update_install` | `main` | Downloads the version found by the check of the most recently queried channel, verifies the signature and installs it. Progress is reported through the channel passed as an argument (`{phase: "download", downloaded, total}`, `{phase: "install"}`). On Windows it hands over to the installer and exits; on Linux it restarts. On failure it stays on the current version and returns a code. On Windows, if the installer could not be started after the core was stopped ahead of it, the app announces this with `app-update-restarting` and restarts on the current version 5 seconds later (#561) |
| `caption_overlay_supported`, `caption_overlay_set`, `caption_overlay_update` | `main` | Checks whether the caption window can be used, opens and closes it, passes what to draw. `caption_overlay_set` takes `{open, position, placement}`. `placement` is the saved top-left position (physical pixels, `{x, y}`, each within ±100000) or `null`. If part of the window at that position (at least 64 pixels in width and in height) stays within the work area of some monitor, the window appears there; otherwise it appears in the band given by `position` |
| `caption_overlay_snapshot` | `caption_overlay` | Reads what to draw. While the user adjusts the captions with Ctrl, `adjusting: true` is added. An `adjusting` passed by `main` is discarded |

The Quick Chat context holds `ready`, `language`, `enter_to_send` and `clear_on_send`, plus the saved `ui_scaling` (an integer, 40 to 200%) and `font_family` (a local font name of up to 256 characters that is not only whitespace and contains no control characters). Rust validates the caller and the values before replacing the context. A request that leaves out the 2 new fields uses 100% and `Yu Gothic UI`. The small window treats the font name as a CSS string and keeps the existing fallback to Noto and system fonts. The settings file keys and the Python-side IPC format do not change.

`main` relays requests from the VR panel (security audit SEC-02). It relays only the operations listed in `VR_PANEL_RELAY_PATHS` (`src-ui/logics/common/vrPanelWire.ts`) as ones the VR panel actually sends, and does not relay unlisted operations, new endpoints included. The list covers the VR panel's own windows and control bar, the 4 launcher switches, the language window and the settings that the VR settings window changes (devices and thresholds; the selection of translation, speech recognition and chat reading; the choice of AI translation model; the seconds and maximum word count that split speech recognition; the VRChat chatbox switch; message conversion; VR captions; display language and font). Quitting and updating the app, opening files, downloading models or runtimes, authentication keys and tokens, endpoints (URLs, the hosts and ports of WebSocket, OBS and OSC, certificates), audio settings, and enabling telemetry and consenting to it are not listed. `main` adds `"origin": "vr_panel"` to the requests it relays, and the backend checks them against the same list (`vr_panel_endpoints` in `native/core/src/dispatch.rs`). A request that is not on the list is not interpreted, and 403 with `vr_panel_request_refused` is returned. A request without `origin` is `main`'s own, and any `origin` other than `vr_panel` is refused. A test confirms that the 3 lists are the same. Only the `main` window has permission to emit events (`src-tauri/capabilities`). The VR panel only has permission to listen to events; it passes its 3 events, such as `vr-panel-stdout`, to `vr_panel_send`, and Rust sends them to `main` ([Events between windows](#events-between-windows)). The state mirrored to the VR panel contains no authentication keys or tokens either ([State mirrored to the VR panel](#state-mirrored-to-the-vr-panel)). The token that restores window sharing (`ocr_portal_restore_token`) is also excluded from relaying and mirroring.

### Events between windows

| Event | Direction | Content |
|---|---|---|
| `quick-chat-requested` | Rust → `main` | A send request came from the small window. `main` takes it with `quick_chat_take` and sends it with `/run/send_message_box` |
| `quick-chat-result` | Rust → `quick_chat` | `{id, accepted}`. A resend with the same ID gets the earlier result |
| `quick-chat-opened` | Rust → `quick_chat` | Returns the focus to the input box |
| `quick-chat-context-changed` | Rust → `quick_chat` | The settings were updated. The payload is not used; the validated settings are read again with `quick_chat_context`. The focus does not move |
| `portal-shortcut` | Rust → `main` | A hotkey was pressed on Wayland |
| `portal-shortcuts-lost` | Rust → `main` | On Wayland, the portal session holding the hotkeys ended without the app asking for it (the portal stopped or restarted). No payload. `main` shows a notice and registers again once, 3 seconds later. If the session drops again within 1 minute, it does not register again and suggests opening and closing Settings |
| `portal-shortcuts-not-restored` | Rust → `main` | On Wayland, registering with the portal failed, and the keys registered before could not be registered again either. No hotkey works. No payload. After the notice about the failed registration, `main` adds that the previous keys could not be restored either, and suggests opening and closing Settings. It is not sent when a newer registration has started. If it arrives while hotkeys are suspended (such as while Settings is open), no notice is shown (#561) |
| `app-update-restarting` | Rust → `main` | During an update, the installer could not be started after the core was stopped ahead of it (#561). No payload. `main` closes the notice that the core stopped and shows "Could not install the update. ASTAROT is restarting with the current version." The app restarts on the current version 5 seconds later. The user did not ask for this restart, so it is announced first |
| `vr-panel-ready` | `vr_panel` → Rust (`vr_panel_send`) → `main` | The VR panel is ready. `main` sends the state again |
| `vr-panel-stdout` | `vr_panel` → Rust (`vr_panel_send`) → `main` | A request from the VR panel. `main` passes only the allowed ones to the sidecar |
| `vr-panel-config-page` | `vr_panel` → Rust (`vr_panel_send`) → `main` | The settings in VR were opened or closed |
| `vr-panel-pointer` | `main` → all | The pointer position in VR |
| `caption-overlay-changed` | Rust → `caption_overlay` | What to draw, or the adjusting state, changed. The payload is not used; the content is read again with `caption_overlay_snapshot` |
| `caption-overlay-moved` | Rust → `main` | A drag with Ctrl held has ended. `{x, y}` is the window's top-left corner (physical pixels). `main` saves it with `/set/data/overlay_desktop_placement` |
| `caption-overlay-font-step` | Rust → `main` | Ctrl and "+" or "-" were pressed over the captions. `1` or `-1`. `main` changes the text size in steps of 2 px within 16 to 72 px and saves it with `/set/data/overlay_desktop_settings` |

#### State mirrored to the VR panel

The screen state is sent over a channel the VR panel opened, not through events (security audit SEC-03, `src-tauri/src/vr_panel_state.rs`). The state includes the conversation log. Events also reach other windows that have permission to listen (the caption overlay and Quick Chat), and even an event with a target reaches listeners that listen without restricting the target. Channel messages reach only the webview that opened the channel.

- At startup, the VR panel passes a channel to `vr_panel_state_subscribe`, and sends `vr-panel-ready` once the channel is accepted. Only calls from the `vr_panel` window are accepted, and the channel of a reopened panel replaces the previous one.
- `main` sends the state with `vr_panel_state_push`. Only calls from `main` are accepted. If no panel is subscribed, it returns `false`, and the next conversation log is sent in full. Closing the panel window discards the channel.
- Only the state that the VR panel's screens read is sent (`vrPanelStateNames` in `src-ui/logics/common/vrPanelWire.ts`). Settings are those of the categories the VR panel reads as a whole (display, devices, translation, speech recognition, chat reading, VR, other). Beyond those, only atoms named in the list are sent, such as the conversation log, the state of the launcher and the language window (including switches whose prerequisites are missing and the identifiers of their reasons), the meters, and the inputs and outputs display. Advanced settings (WebSocket, OBS, OSC, telemetry), updates and hotkeys are not sent. Authentication keys and tokens are not sent even when they are in one of those categories. When VR panel code starts reading a new atom, a test that reads the source (`src-ui/logics/test/vrPanelStateScan.ts`) fails until the atom is added to the list.
- For local translation models the user added, pairs of weight ID and display name are sent. Catalog entries and API URLs stay on the main screen.
- Only the conversation log is sent as a diff against the log sent before. If the sequence numbers do not match, the VR panel asks for everything again with `vr-panel-ready`.

While the conversation log is closed on the VR panel, the panel keeps receiving the state and updating the log. The closed area is not drawn and accepts no input. The subscription to the log body is dropped, and reopening restores the saved scroll position and whether the log was following its end. If the user had scrolled up to read, that position is kept; otherwise the log follows the latest end. If old lines go over the retention limit while the position is saved, the position is corrected the same way as for a normal log update.

The laser position keeps the last `vr-panel-pointer`, and the hover target is looked up again on scrolling inside the panel, content replacement and layout changes. This lookup is batched to once per frame, and `data-vr-hover` is not rewritten if the target has not changed. When the pointer goes away, the hover display is cleared.

### Window sharing (Linux)

For chat reading, the app receives the video of one window that the user chose ([UC-05](use-cases.md)). `screencast_start` is called only in 2 cases. One is when the user presses the button on the settings page. The other is when the user turns chat reading on, no readable window is found by name, and the desktop remembers a window shared before ("Retrying the share when turned on" in UC-05). It is not called at startup.

| Counterpart | Exchange |
|---|---|
| XDG ScreenCast portal (`org.freedesktop.portal.ScreenCast`) | Over a dedicated D-Bus connection, Tauri registers the app ID and calls `CreateSession`, `SelectSources`, `Start` and `OpenPipeWireRemote`, in that order. `SelectSources` gets windows only (`types: 2`), one only (`multiple: false`), no pointer in the video (`cursor_mode: 1`, when supported), remembering the choice (`persist_mode: 2`, when the portal version is 4 or later) and the saved `restore_token`. If the portal's response is 1 (cancelled), the result is `portal_cancelled`; any other failure is `portal_request_failed`; if window sharing is not supported, `screencast_unsupported` |
| `astarot-screen-capture` (`native/screen-capture`) | Tauri starts it with the `OpenPipeWireRemote` connection passed as standard input. The arguments are the parent process ID, the PipeWire node ID, the location of the frame file and the interval (250 milliseconds). It accepts only memory buffers (no DMA-BUF), in BGRx, BGRA, RGBx or RGBA format. It asks the desktop for at most 4 frames per second and drops frames that clearly arrived early. It stops when Tauri closes the standard output pipe or when Tauri exits. It writes `streaming` and the reason it stopped (`screen_capture_<理由>`, where `<理由>` is the reason) to standard error, one line each |
| Frame file | `$XDG_RUNTIME_DIR/astarot/vr-panel-<pid>/screen-frame` (the directory is 0700, the file 0600). The first 64 bytes are little-endian: the marker `ASTRSCR1`, a sequence number (odd while being rewritten), an identifier (0 when sharing ends; the upper 32 bits are the helper's process ID), the width, the height, the bytes per row, the pixel layout (0: BGRx, 1: BGRA, 2: RGBx, 3: RGBA) and the frame time. The pixels follow. The last row holds only width × 4 bytes. The backend uses a frame only when the sequence number is the same even number before and after reading, and takes sharing as ended if the file is missing, the identifier is 0 or the helper process is gone |

A window that does not change sends no new frames, so a stale frame alone is not taken as the end of sharing.

| Event | Direction | Content |
|---|---|---|
| `screencast-ended` | Rust → `main` | Sharing ended without the app stopping it. `{reason}` is `ended` (the window closed, or sharing was stopped on the desktop side) or `failed` (the helper or the portal stopped). `main` resets the sharing display and shows a notice |

Sharing ends on `RunEvent::Exit`. The helper also stops when its parent disappears, so it does not stay behind even if the app is killed.

### Hotkeys

- There are 9 actions: open the small window, minimize and restore ASTAROT, turn translation, the microphone and the speaker on or off, stop speech, mute and resume audio, and turn TTS and RVC on or off. None is assigned by default.
- The hotkeys for stopping speech, muting, TTS and RVC go through the same code as pressing the same buttons and switches on the main screen. They act on the state at the moment of the press, and show the same confirmations and notices. While audio is muted, if the route is not ready, it does not resume.
- On X11 and XWayland they are registered with Tauri's global shortcuts, and on native Wayland with the XDG GlobalShortcuts portal. On KDE, the configured keys are also applied on the desktop side, and a notice is shown if that fails.
- When registering with the portal fails (declined on the confirmation dialog, timed out or a portal failure), the keys registered before are registered again in a new session. The previous session was closed before the new registration, so otherwise all the keys would be gone (#423). The desktop shows the confirmation dialog only for a registration that includes actions it has not seen yet. Registering again uses the actions of the previous successful registration, so the confirmation dialog does not appear again (checked on KDE Plasma 6.8 and GNOME 51, #561). Registering in a new session before closing the old one is not used, because on KDE, closing either of two sessions that have the same actions makes the keys for those actions stop working. If registering again also fails, the app says so (`portal-shortcuts-not-restored`).
- Hotkeys are disabled while the settings screen is open and until the sidecar is ready.
- The keys that change the text size of the desktop captions (Ctrl and `=`, Ctrl+Shift and `=`, Ctrl and numpad `+`, Ctrl and `-`, Ctrl and numpad `-`) are registered by Rust as global shortcuts only while Ctrl is held with the mouse over the caption window, or during a drag. At other times these keys reach other apps. Keys the user has already assigned to hotkeys are not registered.

### Permissions

`src-tauri/capabilities/` allows `main` to operate windows, use shortcuts and open allowed sites. The file, HTTP and program launch (shell) plugins are not in the app. Rust checks that only `main` can call the backend's `backend_*` commands. `quick_chat` is allowed only to receive events, and for commands, Rust checks the name of the calling window.

Only `main` can open URLs in the browser, and only the URLs listed in `opener:allow-open-url` in `vrct_capability.json` (second security audit SEC-02). Permissions that apply to the same window add up, so no file contains a broad permission such as `opener:default`. The list names the destinations of the links the app shows: the user documentation, this repository, the pages of the original VRCT and of its developers, the pages for creating API keys, Hugging Face model cards and license texts. A URL whose path contains `..`, a percent-encoded `.` or `\`, or one that contains `@`, is refused. Matching uses globs, and on Windows `\` and `/` count as the same character. Tests confirm that every URL written in the UI, and every source and license link the Python catalog passes, is in the list (`src-ui/logics/common/openerScope.test.ts`, `src-tauri/src/opener_scope_tests.rs`). When you add a new link, add it to the list too.

---

# 外部インターフェース（日本語版）

ASTAROTが他のプログラムとやり取りする口。UIとサイドカーの間は[IPCプロトコル](ipc-protocol.md)にある。

## VRChatへのOSC

`native/adapters/src/osc/`（0.5まではPythonの[`osc.py`](https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/osc/osc.py)。python-osc、OSCQueryは任意のtinyoscquery）。

| 方向 | アドレス | 引数 | 送る条件 |
|---|---|---|---|
| 送信 | `/chatbox/input` | `[文字列, true, 通知音]` | 「VRChatにメッセージを送信する」がオン（入力欄とマイク）、または「受信したメッセージをVRChatに送信する」がオン（スピーカー）。空の文字列は送らない |
| 送信 | `/chatbox/typing` | `[真偽]` | 入力中の表示。`true`は「VRChatにメッセージを送信する」がオンのときだけ送る。アプリがオンにした表示を消す`false`は、送信設定がオフになった後も送る |
| 受信 | `/avatar/parameters/MuteSelf` | 真偽 | VRCマイクミュート同期 |
| 受信 | `/avatar/change` | — | アバターが変わったら`MuteSelf`を読み直す |

- 送信先は`OSC_IP_ADDRESS`と`OSC_PORT`（既定`127.0.0.1:9000`）。通知音は`NOTIFICATION_VRC_SFX`。
- 起動時に保存済みの送信先を開けないとき（手で書き換えた`config.json`など）は、送信先のアドレスを`127.0.0.1`に戻して保存し、送信と受信をそこで始める。初期化の後に`/set/data/osc_ip_address`の400通知で`VALIDATION_CANNOT_SET_IP`を送り、`data`に使っているアドレスを入れる。`127.0.0.1`も開けないときは保存済みの値のまま同じ通知を送り、送信はしない。Python 版はこの場合に起動できなかった。
- 入力欄の送信操作では、空欄や送信失敗の場合も入力中の表示を消す。空欄への変更、自動クリア、フォーカスの移動、VRChatへの送信をオフにする操作でも消す。入力中の通知は引き続き2秒以上の間隔を空ける。Quick Chatは入力中の通知を出さず、送信時は共通の処理で表示を消す。
- OCRで読んだ文とリアルタイム字幕はVRChatへ送らない。
- 「翻訳後のメッセージのみ送信する」がオンなら訳だけを送る。送る文の形は設定のVRChatページのメッセージフォーマットで決める。
- 送信先と受信のbind先は独立している。OSCQueryは送信先が`127.0.0.1`か`localhost`のときだけ使い、UDP受信とHTTPを常に`127.0.0.1`の空きポートにbindする。`ASTAROT:<時刻>`（0.5.xまでは`VRCT:<時刻>`）という名前で受信口を公開する。送信先を別のマシンから戻した場合も、受信はloopbackで再開する。
- 受信口の広告と探索（mDNS）は、PCの外へ出さない（#559）。送るパケットはすべてIPのTTLを0にする。OSはこれを同じPCのグループの参加者（VRChatを含む）にだけ渡し、ネットワークには送らない。送り元が同じPC（loopbackかPC自身のアドレス）でないパケットは無視するので、ほかのマシンの問い合わせには答えず、その広告も覚えない。広告のアドレスは`127.0.0.1`なので、ほかのマシンは前からこの受信口を使えなかった。参加と送信をloopbackのインターフェースだけにする形では、VRChat（Windowsのデスクトップモードで確認）と互いに見つけられない。
- Windowsでは、mDNSはUDP 5353番で受け取らない（#442）。5353番で待ち受けると、Windowsのファイアウォールが実行ファイルのパスごとに受信を許可するかを確認するためである。インターフェースごとに`0.0.0.0`とOSが選ぶポートのソケットを作り、送るだけにする。公開しているサービスは5秒ごとに知らせ直し、アプリより後に起動したVRChatにも届ける。探索の問い合わせは5353番以外のポートから送るので、答えは問い合わせたソケットに直接届く（RFC 6762の6.7節のlegacy unicast）。この答えのTTLは10秒までなので、問い合わせの間隔は5秒までにする。受け取らないものどうしは互いを見つけられない。Linuxは5353番で受け取る。
- 利用者はOSCQueryを止められる（`OSC_QUERY`、既定はオン。設定の「高度な設定」。中核のみ、#559）。オフのあいだはUDP受信、HTTP、広告、探索のどれも始めない。送信先を変えても始めず、オフにしたときに動いていれば止めて広告を取り下げる。チャットボックスへの送信と入力中の表示は変わらない。VRCマイクミュート同期は使えず、VRChatの在席は`"unknown"`になる。オンに戻すと、今の送信先で受信を始める。エンドポイントは`/get/data/osc_query`、`/set/enable/osc_query`、`/set/disable/osc_query`で、どちらの切り替えのあとも`/run/enable_osc_query`で準備の結果を知らせる。
- OSCの起動、IP・ポート変更、停止は同じライフサイクルロックで直列化する。新しい受信・広告を用意できてから設定を確定し、失敗したら前の受信・広告を復旧する。復旧も失敗した場合は設定値を保ち、capabilityを無効として知らせる。終了要求後の起動は拒否する。
- bundleの時刻によって受信を待たせず、中のメッセージを受信時に処理する。受信は1本のスレッドで行い、そのスレッドは作成時のサーバーだけを使う。
- HTTPには1要求あたり2秒の読み取り期限を設ける。交換・停止・途中の初期化失敗では、UDPとHTTPを閉じ、広告を解除してZeroconfを閉じ、探索ブラウザーも止める。後始末の待機は2秒まで。終わらなければ所有者への参照を保ち、後始末が終わるまで置き換えない。終了時に起動・設定変更のロックを待つ時間も2秒までとする。
- capabilityは、UDP受信、HTTP、OSCQuery広告、探索ブラウザーの準備がすべて成功した場合だけ有効になる。UIの初期値も無効である。送信先が非ローカル、tinyoscqueryがない、bindや広告に失敗した場合は、起動時と設定変更後に`/run/enable_osc_query`で`{"data": false, "disabled_functions": ["vrc_mic_mute_sync"], "reason": …, "microphone_stopped": …}`を送る。`reason`は、利用者がOSCQueryをオフにしているなら`turned_off`（ほかの理由より先に選ぶ）、送信先が別のマシンなら`remote_destination`、このPC宛てなのに準備に失敗したなら`setup_failed`。`microphone_stopped`は、同期がオンだったのでマイク入力を止めた場合に真になる。UIはこの2つで案内の文言を選び、設定画面の同期の欄にも`reason`に合った理由を表示する。別のマシン宛てのときは、OSCの設定を直す案内を出さない。同期がオンだった場合はマイク入力を停止してから同期をオフにし、両スイッチの状態も通知する。ただし、送信先を別のマシンにしたまま、またはOSCQueryをオフにしたまま起動しただけで、同期がもともとオフだった場合は、`disabled_functions`を空にして送る。何も止めておらず、設定で選んだ状態なので、UIは案内を出さない。この場合もcapabilityは無効で、設定画面の同期の欄には理由を表示する。自動で文字起こしを再開しない。その状態で同期をオンにすると`VRC_MIC_MUTE_SYNC_OSC_DISABLED`になる。
- ミュート同期がオンでVRChat側がミュート中のときは、マイクの認識結果を捨てる。
- `MuteSelf=true`はすぐにミュート状態へ反映し、マイクの文字起こしを一時停止する。ミュート中に届いた`false`だけでは再開せず、下記の条件で確認したローカルのVRChatのOSCQueryで`/avatar/parameters/MuteSelf`を読み直し、真偽値の`false`を確認した場合だけ再開する。到達できない、値がない、値が真偽値でない、時間切れの場合はミュートを保ち、`printLog`に理由を記録する。
- 探索結果は、解決済みのIPv4アドレスがすべてloopbackで、サービス名が`VRChat-Client`またはその識別子付きの名前に一致するものだけをHTTPで確認する。`HOST_INFO.NAME`がサービス名と一致し、`OSC_IP`がloopback、`OSC_PORT`が設定した送信ポート、`OSC_TRANSPORT`が`UDP`であることを確かめる。候補を1つに絞れなければ解除しない。LANの広告と名前の部分一致だけの広告は問い合わせず、HTTPのリダイレクトや環境変数のプロキシも使わない。これはローカルプロセスを信頼する境界であり、VRChatプロセスの暗号学的な認証ではない。
- OSCQueryの待ち時間はサービス探索とライフサイクルロックの待機を含めて2秒。確認はOSCの受信スレッドとマイク操作のキューの外で行い、確認中に届いた`true`は古い結果より優先する。時間切れの結果は後から届いても使わない。通信自体を中断できないため、処理中の問い合わせは1件までとし、それが終わるまでは新しい問い合わせも値を取得できない扱いにする。
- `/get/data/vrchat_osc_presence`は、このPCでOSCを有効にしたVRChatが見えているかを`"found"`・`"not_found"`・`"unknown"`で返す。VRChatは、OSCが有効なあいだだけOSCQueryを公開する。探索で見つけたローカルのVRChat（名前が`VRChat-Client`で始まり、アドレスがloopbackだけのもの）に`HOST_INFO`を問い合わせ、応答があれば`found`にする。閉じたVRChatも探索の結果にはしばらく残るため、応答で確かめる。応答するものがなければ`not_found`を返し、探索へ問い合わせ直す。VRChatは起動時に一度だけ自分を知らせるので、アプリより後に起動したVRChatは、この問い合わせ直しで次回に見つかる。OSCQueryを使っていない（オフにしている、送信先が別のマシン、受信を開始できていない）ときは`unknown`にする。起動時の一括取得には含めない。UIは、設定のVRChatページとメイン画面のクイック設定に言葉で表示し、表示しているあいだ5秒ごとに取得する。メイン画面の会話が空の画面も、表示しているあいだ同じ間隔で取得し、`not_found`のあいだだけVRChatのOSCを有効にする手順を1行で出す（`src-ui/views/app/others/vrchat_presence/VrchatOscHint.tsx`）。応答がまだないとき、`found`、`unknown`のときは出さない。送信がオフのときとOSCQueryをオフにしているときは、取得せず、この行も出さない。VRパネルは取得しない。「VRChatにメッセージを送信する」がオフのときは取得せず、オフであることを表示する。会話ログの「送信」は送り出したことだけを表すため、届く状態かどうかはこの表示で示す。
- `/avatar/change`ではまずミュートにして、再読み込みを予約する。実行中または待機中のジョブは1件にまとめ、追加の通知は最新の世代だけを保持する。問い合わせ前と結果の反映前に世代を確かめ、後から届いた`true`を上書きしない。停止時には受付を閉じ、待機中のジョブを取り消し、executorも終了する。問い合わせから探索ブラウザーを作り直すことはない。
- 同期のオン・オフ、起動時の同期、受信による変更は、マイクの開始・停止・デバイス変更と共通のControllerロックを通して一時停止・再開する。受信からの操作はマイク操作キューを使う。問い合わせを待つ間はマイクのロックを保持しない。起動時や同期をオンにした直後など状態が不明な間も、文字起こしを一時停止して結果の配送を止める。
- 送る文の長さに上限や分割の処理はない。VRChat側の制限への対応は[未決事項](open-issues.md)にある。

## WebSocketサーバー

`native/adapters/src/websocket.rs`。他のアプリに会話を配信する。

| 項目 | 内容 |
|---|---|
| 有効化 | `WEBSOCKET_SERVER`（既定オフ）。OBSブラウザソースをオンにすると一緒にオンになる。待ち受けの開始を最大6秒待ち、時間切れや停止要求では起動を取り消してオンにしない。ホストやポートの変更でbindできなければ、元のアドレスで立て直してエラーを返す |
| 待ち受け | `WEBSOCKET_HOST`（既定`127.0.0.1`。IPv4のみ。`0.0.0.0`、IPv6、ホスト名は拒否）、`WEBSOCKET_PORT`（既定2231、整数の1〜65535） |
| 暗号化 | ループバック（127.0.0.0/8）では`ws://`のまま。それ以外のアドレスでは、利用者が指定した証明書と秘密鍵で`wss://`（TLS 1.2以上）だけを使う。使える証明書がなければ待ち受けない（[この PC の外での待ち受け](#この-pc-の外での待ち受け)） |
| 認証 | 接続時に`?token=<WEBSOCKET_AUTH_TOKEN>`を付ける。合わなければ接続前にHTTP 403。トークンは初回起動時に作り、設定画面では伏せて表示する。保存値がnull・空白だけ・空文字列・文字列以外なら、新しく生成した既定の秘密値を保存する。空でないトークンがなければサーバーを起動しない。`/run/regenerate_websocket_auth_token`で作り直すと、古いトークンでの接続をすぐに切り、以後は拒否する |
| 受信 | 使わない。アプリは受信の処理を登録せず、受け取ったメッセージはイベントループの上で捨てる（ワーカースレッドに渡さない）。1メッセージの上限は64 KiB。接続ごとに平均で毎秒10件と128 KiBまで、一時的には20件と256 KiBまで受け付ける。どちらかを超えた接続は1008（policy violation）で閉じ、2秒待っても閉じなければtransportをabortする（セキュリティ監査 SEC-06）。上限は`native/adapters/src/websocket.rs`の`INCOMING_*`と`MAX_INCOMING_MESSAGE_SIZE`の定数 |
| 送信 | 処理したメッセージごとに[メッセージの形](data-and-persistence.md#websocketとobsへ送るメッセージ)を全クライアントへ送る。OBSの表示設定が変わると`SETTINGS_UPDATED`を送る |

ホストとポートは[ネットワーク設定](data-and-persistence.md#ネットワーク設定)の検証に通ってから保存・再起動する。WebSocketとOBSをIPv4に統一し、bindの事前確認とコピーするURLの形式をそろえる。

起動中はまだ待ち受けず、期限内に準備が終わった場合だけ接続を受け付ける。取り消した起動が遅れて完了しても待ち受けを始めない。ループとソケットはその起動のスレッドで閉じ、終了を最大2秒待つ（起動待ちの6秒とは別枠）。中断できない処理が残った場合は参照を保ち、終了するまで再起動を失敗として返す。起動中の無効化やホスト・ポート変更でも、変更前の起動を取り消す。

### この PC の外での待ち受け

ループバック以外のアドレスで待ち受けると、同じネットワークで通信を見られる人がトークンと会話を読めてしまう（セキュリティ監査 SEC-01）。そのため WebSocket と OBS は、ループバック以外では TLS だけで待ち受ける（`native/adapters/src/tls.rs`）。

- 証明書と秘密鍵は`WEBSOCKET_TLS_CERT_FILE`と`WEBSOCKET_TLS_KEY_FILE`（PEMのファイルのパス、既定は空）。同じファイルに両方が入っていてもよい。パスフレーズ付きの鍵は使えない（コンソールで尋ねて止まらないよう、空のパスフレーズで読む）。1 MiBを超えるファイル、通常のファイルでないもの、空のファイルは読まない。
- `/set/data/websocket_tls`は`{"cert_file", "key_file"}`を受け取り、両方を読み込めたときだけ保存する。片方だけ、形の違う要求、読み込めない組は`WEBSOCKET_TLS_INVALID`。両方を空にすると未設定に戻るが、ホストがループバック以外の間は`WEBSOCKET_HOST_NEEDS_TLS`で拒否する。ループバック以外で動いているサーバーは、新しい組で起動し直してから保存する。起動し直せなければ前の組で立て直し、`WEBSOCKET_SERVER_UNAVAILABLE`を返す。エラーの`data`は保存済みの組。
- `/set/data/websocket_host`は、ループバック以外のアドレスに、読み込める証明書がなければ`WEBSOCKET_HOST_NEEDS_TLS`を返し、サーバーを止めない。
- サーバーを起動する処理（`Model.startWebSocketServer`、`Model.startObsBrowserSourceServer`）も同じ確認をする。ループバック以外で証明書を読み込めなければ、待ち受けずに失敗を返す。どの経路からも、平文の待ち受けをLANのアドレスに開かない。
- 起動時、保存済みのホストがループバック以外で証明書を読み込めなければ、ホストを`127.0.0.1`に戻して保存する。初期設定をUIへ渡したあとに、`/set/data/websocket_host`へ`WEBSOCKET_HOST_RESET_WITHOUT_TLS`（`data`は`127.0.0.1`）を送る。以前の版でLANのアドレスを設定していた場合もこの扱いになる。
- 証明書が読めなかった理由はログに理由の種類（`missing`、`unreadable`、`not_a_file`、`size`、`load_failed`）だけを書き、パスやファイルの中身は書かない。
- OBSのHTTPSでは、TLSのハンドシェイクを各要求の処理スレッドで行い、要求全体の5秒の期限に含める。ハンドシェイクを止めたままの接続が、受け付けの処理をふさぐことはない。WebSocketのハンドシェイクの期限は10秒。
- 設定画面がコピーするURLは、ホストがループバックなら`ws://`と`http://`、それ以外なら`wss://`と`https://`。HTTPSで配ったOBSのページは`wss://`で接続し直す。
- OBS用とWebSocket用のトークンは分けない。OBSのページは字幕を受け取るためにWebSocketのトークンを持つので、分けてもOBSのURLを知った人は会話を読める。漏れたときは作り直しで両方を一度に無効にする。

### 送信の上限

上限は`native/adapters/src/websocket.rs`の定数で定める。会話本文を切り詰めたり、待っているメッセージを黙って捨てたりはしない。

| 対象 | 上限・動作 |
|---|---|
| 1メッセージ | UTF-8で256 KiB（`_MAX_OUTGOING_MESSAGE_SIZE`）。超える送信は受付時に`BufferError`で拒否する |
| 送信受付全体 | 128件（`_MAX_PENDING_MESSAGES`）かつUTF-8で4 MiB（`_MAX_PENDING_BYTES`）。ループで実行を待つコールバック、送信キュー、配信中の1件を含む。`send()`と`broadcast()`は同じ枠を使う。満杯なら待たずに`BufferError`を返し、会話の出力処理は既存の`MESSAGE_OUTPUT_FAILED`でWebSocketへの出力失敗を通知する |
| 接続ごとの送信バッファ | 1 MiB（`_MAX_CLIENT_BUFFER_BYTES`）。次のメッセージとフレームヘッダーの余裕14バイトを加えて上限を超える接続は、書き込む前にtransportをabortして切断する。圧縮は無効。正常に読み続けるクライアントには、受け付けたメッセージを順番にすべて送る |
| 生存確認 | 20秒ごとにping（`_PING_INTERVAL`）。ping送信開始からpong受信まで20秒（`_PING_TIMEOUT`）。送信バッファが空くのを待つ時間も含め、時間切れならtransportをabortする。closeフレームの送信完了は待たない |
| 接続の数 | 開いている途中（TLSとWebSocketの開始の手順、トークンの確認の前）の接続は32まで（`MAX_OPENING_CONNECTIONS`）。超えた接続は受け付けてすぐ閉じる。接続済みのクライアントは64まで（`MAX_CLIENTS`）。超えたクライアントは1013（try again later）で閉じる |

配信は32接続ごと、および1メッセージごとにループへ制御を返す。遅い接続のdrainを他の接続が待つことはない。上記はアプリケーションのバッファと受付の上限で、OSのソケットバッファの上限ではない。

## OBSブラウザソース

`native/adapters/src/obs/`。配信画面に字幕を出すHTMLを配る。

- `OBS_BROWSER_SOURCE`（既定オフ）、`OBS_BROWSER_SOURCE_PORT`（既定2232、整数の1〜65535）。待ち受けるアドレスは`WEBSOCKET_HOST`と同じ。ループバック以外ではWebSocketと同じ証明書でHTTPSだけを使う（[この PC の外での待ち受け](#この-pc-の外での待ち受け)）。
- 表示設定の数値は整数に限る。最大メッセージ数は1〜50、表示時間は1〜120秒、フェードアウト時間は0〜120秒、文字サイズは10〜200px、縁取りの太さは0〜20px。IPCでは整数の文字列も受け付け、成功応答と配信通知には保存した整数を返す。範囲外・小数・真偽値は既存の`OBS_BROWSER_SOURCE_*_INVALID`で拒否し、保存も配信もしない。保存ファイルに無効な値があれば、読み込み時に既定値へ戻す。初回表示と開いているページへの更新も同じ範囲を使う。
- OBSとWebSocketのオン・オフ、両サーバーのホスト・ポート変更は[同じIPCロック](ipc-protocol.md#並行性とロック)で直列に処理する。WebSocketをオフにするとOBSもオフになる。OBSだけをオフにしてもWebSocketは止めない。
- OBSの有効化が失敗したら、その試行で新しく起動したWebSocketを停止する。もともと動いていたWebSocketは維持する。有効化中に依存先のWebSocketを起動できなければ`WEBSOCKET_SERVER_UNAVAILABLE`、OBSのポートを確保できなければ`OBS_BROWSER_SOURCE_PORT_UNAVAILABLE`、OBSの起動に失敗すれば`OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE`を返す。
- 保存済みの設定による起動でも、OBSの実際の起動結果を確認する。失敗したらOBSをオフにし、途中まで確保したサーバーを停止する。初期設定をUIへ渡した後に、上記のOBSエラーを通知する。動作しているWebSocketは維持する。
- WebSocketホストの変更では、有効なOBSも新しいホストで待ち受けを開始してから設定を確定する。OBSの再起動に失敗したら両サーバーを元のホストへ戻し、`OBS_BROWSER_SOURCE_HOST_UNAVAILABLE`を返す。WebSocketの復旧にも失敗したら両方をオフにし、OBSだけ復旧できなければOBSをオフにする。
- OBSポートの変更で再起動に失敗したら、元のポートで復旧を試み、`OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE`を返す。復旧できなければOBSをオフにする。整数でないか1〜65535の範囲外のポートには、設定やサービスを変更する前に`OBS_BROWSER_SOURCE_PORT_INVALID`を返す。失敗した要求の値とUIの待機解除は[エラーの扱い](cross-cutting.md#エラーの扱い)に従う。
- `GET /`と`GET /obs`は`?token=<WEBSOCKET_AUTH_TOKEN>`が必要。`hmac.compare_digest`で照合し、トークンがないか合わなければ403と短い平文だけを返す。認証前にHTMLやトークンを返さない。照合には要求ごとに現在のトークンを使うので、作り直した直後から古いトークンは通らない。
- `GET /obs/connection`は`Authorization: Bearer <WEBSOCKET_AUTH_TOKEN>`で同じ照合を行い、現在のWebSocketポートだけを`{"wsPort": 整数}`で返す。トークンは応答に含めず、クエリ文字列による認証は受け付けない。HTMLと同じHost検証とキャッシュ・参照元の制限を使う。
- `GET /health`は認証なしで`ok`だけを返す。それ以外のパスは404。どのパスでも、`Host`がIPアドレスか`localhost`でなければ403（DNSリバインディング対策）。
- HTMLの応答には`Cache-Control: no-store, max-age=0`と`Referrer-Policy: no-referrer`を付ける。アクセスログは出さず、クエリ文字列を記録しない。
- 設定画面からコピーするURLには、WebSocketと同じトークンが入る。画面では伏せて表示する。設定済みのOBSブラウザソースもURLのコピーし直しが必要で、URL欄の下に案内を出す。
- HTTPの同時処理は16件までとし、超過した接続は閉じる。読み取りの待機は5秒、要求全体も5秒を期限とし、0.1秒周期で期限を確認して未完了の接続を閉じる。停止時は新規受付を止め、受け付けた接続を閉じて、待受処理と各要求の終了を合計2秒まで待つ。残った処理があれば所有者を保持し、終了するまで次の起動を認めない。
- ページはWebSocketサーバーに接続して字幕を受け取る。切れたら0.5秒から1.5倍ずつ、最大8秒の待ち時間で再試行する。毎回`/obs/connection`から現在のポートを取り直すため、変更通知を受け取れなくても新しいポートへ接続できる。再取得は5秒で打ち切り、認証失敗・不正な応答・通信失敗でも同じ待ち時間で再試行する。
- 表示の設定と範囲: 最大メッセージ数14（1〜50）、表示時間60秒（1〜120）、フェードアウト12秒（0〜120）、文字の大きさ40（10〜200）、文字色`#FFFFFF`、縁取り3（0〜20）、縁取りの色`#000000`。

## クラウドとネットワークのサービス

| サービス | 接続先 | 認証 | 使う時 |
|---|---|---|---|
| DeepL | `https://api.deepl.com`（Freeキーは`https://api-free.deepl.com`） | APIキー | キーの確認と翻訳 |
| Google Cloud Translation（Basic v2、中核のみ） | `https://translation.googleapis.com/language/translate/v2` | APIキー（`x-goog-api-key`ヘッダー） | キーの確認（`/languages`、訳さない）と翻訳（`format: "text"`） |
| Papago Translation（NAVER Cloud Platform、中核のみ） | `https://papago.apigw.ntruss.com/nmt/v1/translation` | Client IDとClient Secret（`X-NCP-APIGW-API-KEY-ID`、`X-NCP-APIGW-API-KEY`） | キーの確認（空の文を送り、400の`N2MT…`で認証が通ったと見る）と翻訳。直接訳せる組だけ送る |
| Plamo | `https://api.platform.preferredai.jp/v1` | APIキー | キーの確認、モデル一覧、翻訳 |
| Gemini | `https://generativelanguage.googleapis.com`（Developer API） | APIキー | 同上 |
| OpenAI | `https://api.openai.com/v1` | APIキー | 同上 |
| Groq（翻訳） | `https://api.groq.com/openai/v1` | APIキー | 同上 |
| OpenRouter | `https://openrouter.ai/api/v1` | APIキー | 同上 |
| OpenAI互換（翻訳） | `OPENAI_COMPATIBLE_URL` | APIキー | 同上 |
| LM Studio | `LMSTUDIO_URL`（既定`http://127.0.0.1:1234/v1`） | なし | 接続の確認、モデル一覧、翻訳 |
| Ollama | `OLLAMA_URL`（既定`http://localhost:11434`） | なし | 同上 |
| Groq Whisper | `https://api.groq.com/openai/v1` | APIキー | キーの確認（`/models`）と発話ごとの`/audio/transcriptions` |
| OpenAI Whisper | `https://api.openai.com/v1` | APIキー | 同上。`*-transcribe`のモデルには`json`、Whisperには`verbose_json`で要求する |
| カスタムWhisperサーバー | `TRANSCRIPTION_CUSTOM_URL` | APIキー（不要なサーバーでも任意の文字列） | 同上 |
| Deepgram | `https://api.deepgram.com/v1` | `Authorization: Token <キー>` | キーの確認（`/auth/token`）、モデル一覧（`/models`）、発話ごとの`/listen` |
| Hugging Face | `https://huggingface.co/{repo}/resolve/{rev}/{path}` | なし | 利用者が同意したモデルの取得。接続先はhuggingface.coとそのCDNに限る |

- クラウドの音声認識の仕様への準拠は各サービスの公式文書で確かめる。
- Python 版にあった Google の Web 音声認識（非公式の窓口に`speech_recognition`の汎用のキーで FLAC 音声を送るもの）は使わない。中核にはその窓口もキーもない。
- OpenAI互換の音声認識では、接続と接続プールの待機を10秒、読み取りとアップロードの書き込みを60秒でタイムアウトさせる。通信が進まない時間の上限であり、SDKの再試行を含む要求全体の期限ではない。
- OpenAI互換、Deepgramの自動検出結果は、返された言語名・コードを選択済みの言語と国に照合する。大文字小文字や`_`と`-`の違いを揃え、地域・文字体系まで一致する候補を優先する。ベース言語しか分からない場合は、その言語に一致する最初の候補を使う。検出言語がない、または選択候補に一致しない場合は、本文を保持し、内部の認識結果の`language`を`None`とする。従来のマイク・スピーカー認識では、配送時の設定スナップショットでもこの不明な値を保ち、先頭の候補言語を推測で付けない。要求で言語を明示した場合は、その指定を使う。
- Deepgramの成功応答でも、結果の構造、文字列の本文、0〜1の有限な数値の信頼度が揃わなければ`TRANSCRIPTION_API_SERVER_ERROR`として扱い、既存の音声パイプラインのエラー経路に渡す。構造が正しい空の本文は、通常の「認識結果なし」として扱う。応答本文や秘密情報は診断ログに残さない。
- 起動時に接続の確認を送らない（0.4までは、起動時の自動取得を予定しているときだけ`https://huggingface.co/`へHEADを送っていた。自動取得は0.5.0で引退した）。中核は`/run/connected_network`に`null`（未確認）を送る。真偽値なら取得ホストへの確認結果を表す。UIは`false`のときだけ接続エラーを表示する。この値だけでクラウドのエンジンなどを使えない状態にはせず、各要求の成否で判定する。
- 公式APIの接続先はコードで固定する。環境変数によるOpenAI・GeminiのURL変更、LangSmith gateway、OllamaのAPIキーは使わない。クラウドHTTPSではシステムのプロキシを使える。Requestsの認証は登録済みヘッダーを保ち、netrcの認証情報へ置き換えない。localhostとローカルIPアドレスへのAPI接続ではプロキシを使わない。APIのリダイレクトは追わず、モデル取得だけは既存のHTTPSホスト許可リストに従う。
- カスタムURLの許可範囲と保存時の扱いは[ネットワーク設定](data-and-persistence.md#ネットワーク設定)を参照する。
- 更新の確認と取得はRust側（Tauriのupdater）が行う（[アプリの更新](#アプリの更新)）。

### 利用状況の通知

送るかどうかの条件は[横断的な振る舞い](cross-cutting.md#同意と外部への送信)にある。受け側はASTAROTのもの（Cloudflare Workers）で、このリポジトリの外で管理している。受け側の検査の規則を変えるときは、先に受け側の担当と合わせる。

| 項目 | 内容 |
|---|---|
| 宛先 | `POST https://vrct-vox-telemetry.kei9d09.workers.dev/v1/events`。接続先はコードで固定する |
| 鍵 | ヘッダー`X-Ingest-Key`。アプリに埋め込む公開の値で、2種類の通知を送る以外の権限はない |
| 本文 | `{"event": "app_started", "v": 2, "timestamp", "app_version", "os", "os_version", "locale", "hw"}`。`error`はこれに`error_code`（`[A-Za-z0-9_.-]{1,64}`）が付く |
| `timestamp` | 通知を組み立てた時刻。ISO 8601のUTCで、秒まで（`YYYY-MM-DDTHH:MM:SSZ`） |
| `hw` | `{"cpu", "cores", "ram_gb", "gpus": [{"name", "kind", "vram_gb", "driver"}]}`。読み取れた項目だけが入り、何も読めなければ`hw`ごと省く。名前は表示できるASCIIの64文字まで。`ram_gb`は一般的な容量の段階に丸める。`gpus`は4台まで。`kind`は`gpu`か`igpu`。`driver`はWindowsではレジストリにあるディスプレイアダプターのドライバのバージョン、LinuxではNVIDIAのドライバのバージョンだけ |
| `os`と`locale` | `os`は`Windows`、`Linux`、`Other`のどれか。`locale`は表示言語をタグにしたもので、`ja`なら`ja-JP`、それ以外は`en-US`になる |
| 応答 | `200 {"ok": true, "accepted": N}`。鍵がなければ401、JSONでなければ400。検査に通らない通知は`accepted`に数えない |
| 通信 | 1件につき1回のPOST。タイムアウトは5秒。リダイレクトは追わず、プロキシは使わない。失敗しても再送しない |

- 2種類以外の通知と、形式に合わないエラーコードは、送る前に捨てる。
- PCの構成は同梱のspeech.cppの`speech devices --json`から読む（[モデル取得の目安](../voice-stack/model-downloads.md)と同じ一覧）。起動は待たせず、最初の通知の前に1回だけ読む。
- デプロイ済みの受け側は、知らない項目が付いた通知も受け付ける（2026-11-14に`v`と`hw`を付けた`app_started`で確認した。応答は`accepted: 1`）。受け側が`hw`を保存するかどうかは受け側の実装による。
- 環境変数`ASTAROT_TELEMETRY_URL`は、開発者が自分のPCに立てた代わりの受け側を指すためのもので、ループバックのHTTPのアドレスだけを受け付ける。ほかの値は無視する。
- 受け側は送信元のIPアドレスや端末の識別子を保存しない設計である（受け側の担当の説明による）。通信の相手として、Cloudflareは送信元のアドレスを扱う。
- 受け側は通知ごとに、受信した時刻と接続元の国を記録する。国はクライアントが送る値ではなく、Cloudflareが接続元のアドレスから出す値である（2026-11-14に受け側の読み取り用のビューで確認した）。利用者に見せる説明にもこの2つを含める。

### GPUの動作の報告

設定の「高度な設定」→「GPUの動作の報告」（#288の判断6）。利用状況の通知とは別のもので、アプリは何も送らない。利用者が押したときだけ中核が計測し、結果を画面に出す。送るかどうかは利用者が選び、送るときは利用者自身がGitHubのIssueとして送る。

| 項目 | 内容 |
|---|---|
| 始め方 | `/run/start_gpu_check`（設定の「確かめる」）。答えは`{state, run}`だけ。1つずつ動き、動いている間の開始はその回に合流する。`/run/stop_gpu_check`で止める |
| 状態 | `/get/data/gpu_check_state`は`{state: idle\|running, run, step, outcome: done\|cancelled\|failed\|null, error_code, report, text}`。UIは動いている間だけ1秒ごとに読む。起動時の一覧には入れず、ログにも書かない |
| 計測 | 同梱のspeech.cppのコマンド（`speech info`、`speech tts`、`speech asr`）を、設定済みの読み上げのモデル（`japanese`か`multilingual`）と音声認識のモデル（`asr`）で、CPUと計算に使えるGPU（4台まで）のそれぞれで動かす。読み上げは決まった短い文（日本語か英語）を一時フォルダのWAVEに書き、音声認識は最初に読み上げられた機器の音声を各機器で文字にする。モデルの取得、マイク、スピーカー、動いているサーバーには触れない。一時フォルダは終わりに消す |
| `report` | `{report: "astarot-gpu-check", schema: 1, app_version, os, os_version, hardware, speechcpp: {version, builds}, devices: [{device, kind, name, memory_gb}], busy, translation: {devices, measured: false}, tts, asr}`。`hardware`は利用状況の通知の`hw`と同じ形。`tts`と`asr`は`{model, language, runs}`か`{skipped: no_model\|no_audio\|no_voice\|unsupported_language\|model_unreadable}`。`runs`の各行は`{device, ok, ran_on, load_s, audio_s, work_s, rtfx, first_audio_s, total_s, error}`で、音声認識には文との文字の誤り率`cer_to_sentence`とCPUの文字との誤り率`cer_to_cpu`が付く。`error`はspeech.cppの失敗の種類（`out_of_memory`など）か`timed_out`、`cancelled`、`exit_<コード>` |
| 入れないもの | ファイルの場所、ユーザー名、PCの名前、読み上げた文と聞き取った文、音声、speech.cppが出したメッセージ。モデルはファイルが持つ名前と量子化の種類だけ（ASCIIの64文字まで） |
| `text` | `report`を整形したJSON。画面に全文を出し、コピーとIssueにはこの文字列をそのまま使う |
| 送り方 | 「GitHubで報告する」は、Issueの様式`gpu_report.yml`を`template`、タイトル、`report`の欄の値を付けたURLで開き（openerの許可は`https://github.com/kein5/astarot/**`）、同じ内容をクリップボードにも写す。URLが7000文字を超えるときは`report`を付けずに開き、貼り付けてもらう |

### ONNX Runtimeの利用状況の送信を止める

同梱のONNX Runtime（チャット読み取り、ローカル翻訳、声質変換のワーカー）は、Microsoftの公式ビルドが持つ利用状況の送信を、アプリの同意の設定にかかわらず常に止める（#518）。

- アプリ（`src-tauri/src/lib.rs`の`run`）と、ONNX Runtimeを読み込む各ツール（`ocr-read`、`astarot-translate`、`astarot-rvc-worker`ほか）は、ほかのスレッドを始める前に環境変数`ORT_DISABLE_TELEMETRY=1`を設定する。声質変換のワーカーはアプリからこの値を受け継ぐ。
- ONNX Runtimeの環境はすべて`with_telemetry(false)`（`DisableTelemetryEvents`）で作る。
- Linux版（1.31）は、環境を作った時点で`~/.cache/Microsoft/DeveloperTools/.onnxruntime/`に`deviceid`とイベントのデータベースを作り、`mobile.events.data.microsoft.com`へ送る。止められるのは環境変数だけで、`DisableTelemetryEvents`は環境を作った後に呼ぶため、最初のイベントとファイルには間に合わない（2026-11-17に公式の`onnxruntime-linux-x64-1.31.0.tgz`で確認した）。
- Windows版（1.31）はHTTPで送らず、ETWのイベント（プロバイダー`Microsoft.ML.ONNXRuntime`）を書くだけで、`deviceid`のファイルも作らない。集めるかどうかはWindowsの診断データの設定による。環境変数は読まず、`DisableTelemetryEvents`で止める。環境を作るときの最初の`ProcessInfo`イベントだけは、この設定より前に書かれる。
- 試験：`tests/voice/test_onnx_runtime_telemetry.py`が、環境を作る箇所と各実行ファイルの`main`の最初の文を確かめる。

### WebView2の通信

Windowsの画面を描くWebView2 Runtimeは、アプリの画面とは別にMicrosoftへ通信する。アプリの同意の設定では止まらない。

Microsoftの文書（[Data and privacy in WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy)）による扱いは次のとおり。

- 任意の診断データは、Windowsの「設定」→「プライバシーとセキュリティ」→「診断とフィードバック」の「診断データ」に従う。必須の診断データは、この設定にかかわらず集める。アプリから全体を止める方法はない。
- アプリが変えられるのはSmartScreen（`IsReputationCheckingRequired`）と、クラッシュダンプの送信（`IsCustomCrashReportingEnabled`）だけである。どちらもAPIで、環境変数はない。
- 環境変数`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`は、アプリが渡す起動引数の後ろに足される（[CreateCoreWebView2EnvironmentWithOptions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions)）。テレメトリを止めるフラグは、公式のフラグの一覧（[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)）にない。この一覧も、配布するアプリでフラグを使わないよう求めている。

0.5.0のWindows版（WebView2 Runtime 158.0.4370.26）を、空のWebView2のデータフォルダーで150秒起動し、WebView2のネットログ（`--log-net-log`）を取った結果は次のとおり（2026-11-17）。文字の入力と音声は使っていない。

| 宛先 | 内容 | `--disable-background-networking`を付けたとき |
|---|---|---|
| `config.edge.skype.com` | Edgeの実験と設定の取得（`/config/v1/Edge/<版>`） | なくなる |
| `edge.microsoft.com/componentupdater`と`msedge.b.tlu.dl.delivery.mp.microsoft.com` | コンポーネントの更新の確認と取得 | 36回の確認と8件の取得が、起動直後の4回と1件になる |
| `nav-edge`、`data-edge`、`telem-edge`（`.smartscreen.microsoft.com`） | SmartScreenの確認と、その送信 | 残る（SEC-03で止めない） |
| `wpad` | プロキシの自動検出 | 残る |

- 全ウィンドウの起動引数（`BROWSER_ARGS`）に`--disable-background-networking`を入れて、上の2つを止める。Chromiumのスイッチで、WebView2の公式の一覧にはないため、Runtimeの更新で効かなくなることがある。暫定の対策とし、Runtimeの版が大きく上がったら同じ方法で確かめ直す。
- 環境変数ではなく起動引数に入れるのは、環境変数がサイドカーや起動した別のプログラムにも受け継がれるためである。WebView2から見ると、どちらも同じ起動引数の並びになる。利用者が`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`を設定していれば、その後ろに足される。
- Windowsの診断データ（WebView2の文書がいうWindows data reporting）は、この対策の外にある。ネットログに出ず、Windowsの設定に従う。
- クラッシュダンプは送らない（#564）。全ウィンドウが共有するWebView2の環境をアプリが作り（`src-tauri/src/webview_environment.rs`）、`IsCustomCrashReportingEnabled`をオンにする。WebView2は異常終了の記録をMicrosoftへ送らず、ユーザーデータのフォルダーに残す。アプリはその記録を読まず、送りもしない。
  - 環境の中身は、Tauriとwry（0.57）が作るものと同じにする。ユーザーデータのフォルダー（`app_local_data_dir`）、起動引数（`BROWSER_ARGS`）、言語（利用者のUIの言語）、拡張機能はオフ、スクロールバーは既定である。これにクラッシュダンプの設定を足す。
  - 全ウィンドウがこの1つの環境を使う。同じユーザーデータのフォルダーに別の設定の環境を作ると、WebView2はそのウィンドウを作らない。そのためウィンドウは`webview_environment::window`と`webview_environment::main_window`だけで作る（ほかの場所でTauriのビルダーを直接使っていないことをテストで確かめる）。`main`は`tauri.conf.json`で`"create": false`にして、環境を作った後に`setup`で作る。
  - 環境を作れなかったときは、起動ログに理由を書き、各ウィンドウはTauriが作る環境で開く（この変更の前と同じ）。そのときのクラッシュダンプの送信はWindowsの設定に従う。

### アプリの更新

Tauriのupdater（`tauri-plugin-updater`）で行う（`src-tauri/src/app_update.rs`、#330）。UIは`app_update_*`のコマンド（[Tauriのコマンド](#tauriのコマンド)）だけを使い、updaterのプラグインのコマンドの権限はどのウィンドウにも与えない。

| 入れ方 | 判定 | 更新でできること（`mode`） |
|---|---|---|
| Windowsのインストーラー | 実行ファイルの隣に`uninstall.exe`がある | 確認して入れる（`install`）。インストーラーを`/P /UPDATE /R /ARGS …`で起動し、アプリは終了する。0.5までのアプリは`/EDITION=cpu`か`/EDITION=gpu`も渡すが、インストーラーはどちらでも1つのZIP（0.7.0からは`ASTAROT.zip`、0.6.xまでは`VRCT-VOX.zip`）を取る（#288） |
| WindowsのZIP | 上のどれでもない | 確認して知らせるだけ（`manual`） |
| AppImage | `APPIMAGE`があり、そのフォルダーに書き込める | 確認して入れる（`install`）。AppImageを置き換えて再起動する |
| 書き込めない場所のAppImage | `APPIMAGE`のフォルダーに書き込めない | `manual` |
| Linuxのtar.gz | 上のどれでもない | `manual` |
| deb、rpm | 実行ファイルの隣に`package-manager`がある（`tools/linux_packages.py`が置く） | 確認しない（`package_manager`） |
| 開発用のビルド | debugビルド | 確認しない（`disabled`） |

- 更新の情報はGitHubのリリースの`latest.json`である。安定版（版に`-beta`がない）は`https://vrct-vox-updates.kei9d09.workers.dev/latest.json`を読む。この宛先はプロジェクトのCloudflare Workersで、最新のリリース（`https://github.com/kein5/astarot/releases/latest/download/latest.json`）へ転送する。プレリリースは「latest」にならない。ベータ版は同じWorkerの`/beta/latest.json`を読み、取れなければ安定版の`latest.json`を読む（updaterは、失敗の状態コードや通信の失敗のとき次の宛先を試す）。Workerはこれをこのリポジトリのブランチ`updater-channels`の`beta/latest.json`（`raw.githubusercontent.com`）へ転送する。このファイルは、リリースを公開するたびにワークフロー（`.github/workflows/update-channels.yml`、`tools/update_channels.py`）が、`latest.json`を持つ下書きでないリリースのうち最も新しい版（ベータ版と安定版の両方）の`latest.json`に書き直す。版がそのリリースのものでないもの、ファイルがそのリリースのダウンロードでないものは書かない（#466）。アプリはベータ版の確認のためにGitHubのAPIを呼ばない。どちらも認証なしで、ヘッダーはupdaterの既定とUser-Agentだけである。
- 更新のチャンネル（#466）: 上の「安定版」「ベータ版」の読み方は、`SELECTED_RELEASE_CHANNEL`（`stable`か`beta`）に従う。利用者がまだ選んでいなければ、起動のたびに動いている版から決める（版に`-beta`か`-rc`があれば`beta`）。設定の実験的機能のページで選ぶと（`/set/data/release_channel`）、`RELEASE_CHANNEL_CHOSEN`を`true`にして、その値を次の起動からも保つ。Betaでは安定版の版からもプレリリースが候補になる。updaterは今の版より新しい版だけを候補にするので、ベータ版を使っていてStableに戻すと、前の版には戻さず、次の安定版が出たときに更新する。更新のページの確認は`app_update_check`の`channel`に、バックエンドの更新のエンドポイントは中核がこの設定を渡す。確認の結果を共有するのは同じチャンネルの確認どうしだけである。チャンネルを変えると、前のチャンネルで見つけた版の表示を消して、すぐに新しいチャンネルで確かめる（起動時の確認をオフにしていても、利用者が変えた操作に対する確認なので行う。ダウンロードやインストールの途中なら何もしない）。`app_update_check`は1つずつしか受け付けない（2つ目は`update_busy`）ので、確認の途中で変えたときは、その確認が終わるのを待ってから新しいチャンネルで確かめ、その間は「更新を確認しています…」と示す。途中だった確認の結果は前のチャンネルのものなので、画面に出さない。続けて何度か変えたときは、最後に選んだチャンネルだけを確かめる。こうして、画面に出る版と、インストールの対象（`app_update_check`が最後に見つけた版）は、いつも最後に選んだチャンネルのものになる（`src-ui/logics/common/appUpdate.ts`）。Tauriの側も、画面とは別に同じことを守る（#1017）。`app_update_check`が前と違うチャンネルを問い合わせた時点で、前のチャンネルで見つけた版をインストールの対象から外す。その確認が`update_busy`で断られても、失敗しても外す。別のチャンネルを問い合わせた後に終わった確認の版は、インストールの対象にしない。更新のページの版の横の「（ベータ版）」は、動いている版のチャンネル（`app_update_info`の`channel`）を表す。
- `latest.json`の`platforms`は`windows-x86_64`（`ASTAROT_setup.exe`）と`linux-x86_64`（`ASTAROT-<version>-linux-x64-release.AppImage`）を持つ。0.6.xまでは`VRCT-VOX_setup.exe`と`VRCT-VOX-<version>-linux-x64-release.AppImage`だった。0.7.xのリリースはどの配布物も0.6.xまでの名前の写しと一緒に載せるが、`latest.json`は写しを指さない（ADR-014の2.10、[配布候補の手順](../voice-stack/release-candidates.md#旧名の写し)）。0.6.xのアプリも`latest.json`に書いたURLから取るので、名前が変わっても更新できる。下書きを作るワークフロー（`prepare-release.yml`）が、検証済みの候補を`tauri signer sign --app-version`で署名し、`tools/updater_manifest.py`で書く。
- 取得したファイルは`tauri.conf.json`の公開鍵（minisign、鍵ID `1178836E5C9F510B`）で検証し、署名の信頼済みコメントにある版が`latest.json`の版と一致することも求める（`requireSignedVersion`）。一致しなければ入れない。
- インストーラーは`/UPDATE`のとき、言語のページを飛ばし、`installer_language.txt`を書かず、ショートカットを作り直さない。ZIPの取得とSHA-256の照合、段階的な置き換えは通常のインストールと同じである（[配布候補の手順](../voice-stack/release-candidates.md)）。0.7.0からのインストーラーは、0.5.0以前の既定のインストール先にあるインストールを更新のあとで`%LOCALAPPDATA%\ASTAROT`へ移す。`/UPDATE`のときも同じで、`/R`は移した先の実行ファイルを起動する（[Windowsのインストール先の移動](data-and-persistence.md#windowsのインストール先の移動)）。0.7.0からの本体は`astarot.exe`で、インストーラーは0.6.xまでの`vrct-vox.exe`を置き換え、`/R`で`astarot.exe`を起動する（[本体の実行ファイルの名前](data-and-persistence.md#本体の実行ファイルの名前)）。
- インストーラーは、利用者のセッションで同時に1つだけ動く。アプリの更新が起動したインストーラーと、利用者が開いたインストーラーが重なると、後から起動した方はほかのインストーラーが動いていることを知らせ、何も変えずに終了コード2で終わる。知らせは、サイレント（`/S`）なら起動したコンソールに書き、それ以外（`/P`を含む）ならメッセージで出す。取得するファイルは、実行ごとに作る`%TEMP%`の中のフォルダーに置き、終わるときに消す（[配布候補の手順](../voice-stack/release-candidates.md#windowsのwebview2とインストール時の通信)）。
- 起動ログ（`startup_log`）には失敗の種類とURLだけを書く。会話や音声は扱わない。
- バックエンドの更新のエンドポイントも同じupdaterを使う（`app_update.rs`の`CoreUpdates`を`backend_host.rs`が中核に渡す。[判断20](../voice-stack/core-integration.md#判断が要ること)）。
  - `/get/data/available_releases`は、上のGitHubのリリースの一覧（新しい30件）から、更新のチャンネルが取るものを新しい順に`[{tag, version, is_prerelease, published_at}]`で返す。Stableは安定版だけ、Betaは両方。下書き、版でないタグ、`latest.json`がないもの、このリポジトリのダウンロードでないものは除く。確認しないコピー（deb、rpm、開発用のビルド）は通信せずに空を返す。
  - 起動時の`/run/software_update_info`（`{is_update_available, new_version}`）は、`CHECK_SOFTWARE_UPDATES`がオンのときだけupdaterで確かめる。オフなら通信せずに「更新なし」を送る。更新の画面の確認と同時に走るので、走っている確認の結果と、終わってから30秒以内の成功した結果は共有する。チャンネルを前と違う値に変えると（`/set/data/release_channel`）、中核は新しいチャンネルで同じように確かめ直して送る。オフなら通信せずに「更新なし」をもう一度送る。前のチャンネルの確認が、変えた後に終わったときは、その結果を送らない。こうして、最後に送った`/run/software_update_info`は、いつも今のチャンネルのものになる（#1017）。
  - `/run/update_software`と`/run/update_cuda_software`は、更新のチャンネルの最新版か、`data`の版（一覧にある版）を取得し、署名を確かめて入れる。配布物は1つなので、2つのエンドポイントは同じ動きである（`/run/update_cuda_software`はIPCの契約として残す。UIは`/run/update_software`だけを使う）。`mode`が`install`でないコピーでは入れない。署名の失敗は`UPDATE_SOFTWARE_VERIFY`、ほかの失敗は`UPDATE_SOFTWARE_DOWNLOAD`で、今の版のまま動き続ける。

### LLMでの翻訳

Plamo、Gemini、OpenAI、Groq、OpenRouter、OpenAI互換、LM Studio、Ollamaは、現在の翻訳対象の本文、言語の指定、プロンプトと直近の会話履歴を接続先へ送る。プロンプトにはシステム向けの指示と対応言語も含む。中核は各社のSDKを使わずにAPIを直接呼び、ヘッダーの`User-Agent: ASTAROT`のほかに実行環境の情報を送らない（`native/translation/src/http.rs`。0.4までのPythonではSDKがOSやライブラリの版などを送っていた）。LM StudioとOpenAI互換では設定したURLが送信先になり、OpenRouterでは選んだモデルの提供元にも処理が渡る。

履歴にはチャット・マイク・スピーカーの発言を使う。直近の最大5件を、時刻と入力元を付けて含め、整形後の履歴は最大4,000文字に制限する。OCRの過去の履歴は含めないが、今回の翻訳対象がOCRの本文なら送る。これらは中核の`native/translation/src/prompt.rs`の定数（`HISTORY_SOURCES`、`HISTORY_MAX_MESSAGES`、`HISTORY_MAX_CHARS`）で決まり、履歴専用のUIスイッチはない（0.4までは`src-python`のプロンプトファイルで同じ値を決めていた）。DeepLとCTranslate2はこの履歴を送らない。

利用者は、これらのエンジンに本文のほかに頼むことを2つ設定できる（設定の翻訳ページの詳細設定、#392）。どちらも空欄が既定で、空欄なら0.4までと同じ要求を送る。

- 温度（`LLM_TRANSLATION_TEMPERATURE`）: 0から2までの小数（小数点以下2桁まで）を文字列で保存する。設定したときだけ、チャット形式のAPIでは`temperature`、Geminiでは`generationConfig.temperature`、Ollamaでは`options.temperature`として送る。空欄のときは送らない（Geminiは今までどおり0.7を送る）。温度を付けた要求が400で断られたときは、温度を外して1回だけ送り直す（OpenAIの推論モデルは既定以外の温度を受け付けない）。Responses APIだけのモデルには付けない。
- 追加の指示（`LLM_TRANSLATION_INSTRUCTIONS`）: 制御文字を含まない1行、500字までの文字列。システムプロンプトの決まり（訳文だけを返す）の後、用語辞書と会話履歴の前に、「その決まりを変えない範囲で従う」と添えて入れる。指示は送信先に送るが、`process.log`には書かない。

ローカルのTranslateGemma（llama.cpp）は、モデルカードの書式と貪欲な生成（温度0）で動かすので、どちらも使わない。

翻訳用履歴はメモリー内に最大20件保持し、同じ送信先を使い続ける間だけ引き継ぐ。[同意と外部への送信](cross-cutting.md#同意と外部への送信)に従い、エンジン・URL・モデルの変更で履歴の世代を更新する。翻訳のオン・オフ、タブ、翻訳用APIキー、CTranslate2の重み、選択していないエンジンのURLやモデルを変えた場合も、誤送信を防ぐために無効にする。同じ値の再保存では無効にしない。世代を戻す処理はなく、送信先を切り替えて戻っても古い履歴は再利用しない。

各メッセージは受付時の世代を保持し、処理中に設定が変わった場合は履歴の利用と追加を省く。要求ごとに履歴とクライアントの参照を固定し、空の履歴も明示的に渡す。既に始まった要求は、それまでの接続先への送信が続く場合がある。設定を変えても送信済みの情報は取り消せない。履歴の無効化は翻訳用の一時バッファだけに作用し、画面やファイルの会話ログは変えない。

## ローカルの音声サーバー

| 相手 | 起動 | 通信 |
|---|---|---|
| 同梱のspeech.cpp（TTS、ASR） | `build/speechcpp/speech serve …`（LinuxのCPU版は`build/speechcpp-cpu`）。中核が直接起動し、Linuxでは起動したスレッドが終わると子プロセスも終わる（`native/speech-server/src/child.rs`の`PR_SET_PDEATHSIG`）。プロファイルは`japanese`、`multilingual`、`asr` | OSが割り当てた`127.0.0.1`のポート。`GET /health`、`GET /v1/models`で準備を確かめる。起動の待ち時間は120秒 |
| 外部のspeech.cpp | 利用者が起動する | ループバックの`http`だけを受け付ける |
| 読み上げ | — | `POST /v1/audio/speech`に`{input, voice, language, response_format: "pcm", seed?, instructions?}`。応答は`audio/pcm`。4000文字まで |
| 音声認識（REST） | — | `POST /v1/audio/transcriptions` |
| リアルタイム音声認識 | — | `ws://…/v1/realtime`。`session.update`と`input_audio_buffer.append`、`commit`、`clear` |
| 話者分離（任意） | `asr`プロファイルに話者分離モデルのパスがあれば、同じサーバーに3つ目のモデルとして読み込ませる | `/v1/models`がCPU以外の装置にある`diarization`を返すサーバーへのスピーカーの接続だけが、`session.update`の`audio.input.diarization`に`{}`を入れる。確定した発話の`speakers`（ラベル、開始、終了）を受け取る。マイクの接続は要求しない |
| RVCワーカー | `build/astarot-rvc-worker`（Rust、`native/rvc-runtime`）。中核が直接起動する（`native/voice-conversion/src/child.rs`） | stdin・stdoutでPCM（48kHz、`--block-ms`の長さのブロック単位。中核は`RVC_BLOCK_MS`を渡す。既定の0（自動）では`--block-ms auto`を渡し、ワーカーがGPUで間に合う長さを選ぶ。指定がなければワーカーは80 msで3840フレーム。`ready`の`block_frames`で長さを返す）。制御はJSON行（32KiBまで）。ONNX RuntimeとCUDAのライブラリは実行環境のフォルダーの`lib/`から読み込む。GPUを使えなければCPUで変換する。readyで変換する場所（`profile`が`low`ならGPU、`cpu`ならCPU）と、加える遅れ（`latency_ms`）を伝える。CPUで追いつかないときは、出力の代わりに`failed`（`vc_capture_overrun`）を送って止まる |

同梱TTSサーバーの停止・異常終了は、起動ごとの識別子と、その実行を使うTTSの世代を照合して処理する。現在のTTSが使うサーバーが終了したときは、TTSをオフにして待機中・再生中の読み上げを取り消し、従来どおり音声の状態取得でUIに伝える。同じ実行の停止直後と後処理後に通知が重なっても、無効化とTTSの世代更新は一度だけ行う。古い実行からの遅れた通知で、別の接続先や新しいサーバー実行を使うTTSをオフにしない。

同梱のspeech.cppは、Windowsでは`_internal/build/speechcpp`のVulkan版だけ、Linuxでは同じ場所のVulkan版と`_internal/build/speechcpp-cpu`のCPU版の2つである。起動のたびに、設定の推論デバイスでどちらを使うかを決める。`cpu`はCPU版（Windowsでは同じVulkan版を`--device cpu`で）、`gpu`とGPUの名前はVulkan版、`auto`はVulkan版の`speech devices --json`が動いて計算に使えるGPUを示せばVulkan版、そうでなければCPU版を使う。Vulkan版が起動しなかった（`libvulkan.so.1`がない）ために`auto`をCPU版で動かしたときは、`/get/data/speech_server_state`のそのプロファイルに`notice: "speech_server_cpu_fallback"`を付ける。`/get/data/speech_server_devices`は、GPUの行（`devices`）に加えて、CPUを何で動かすか（`cpu_build`: `separate`、`shared`、`missing`）とGPUの選択肢が起動できるか（`gpu_build`: `ready`、`unavailable`、`missing`）を返す。細かいところは[中核の統合](../voice-stack/core-integration.md)の「判断が要ること」の「決まったこと」にある。

同梱ASRサーバーは認識モデルとVADモデルを必ず読み込み、設定に話者分離モデルのパスがあるときだけそれも読み込む。起動の確認では`/v1/models`の内容を設定と照合する。話者分離モデルを指定したのにサーバーがそれを持たないとき、指定していないのに持つときは、`speech_server_model_tasks`で起動を失敗にする。

同梱ASRサーバーも、起動ごとの識別子とマイク・スピーカーそれぞれの収録世代を照合する。終了した実行を使う収録だけを停止し、同じ終了通知を重ねて処理しない。古い実行の通知で新しい収録を止めない。異常終了で停止した場合は、従来どおり原因を通知する。

TTSのスイッチをオフにしたときは、そのスイッチが起動した同梱サーバーだけを止める。設定画面から起動したサーバーと、独立したRVCのスイッチは維持する。

設計の経緯は[`docs/adr/`](../adr/README.md)の ADR にある。

### 利用者が入れた合成音声エンジン

日本語の読み上げには、利用者が入れて起動したエンジンも使える（[ADR-008](../adr/adr-008-external-speech-engines.md)）。アプリはエンジンを同梱せず、入れることも起動することもしない。接続先はループバックの`http`だけで、`local_url()`で確かめる。日本語以外は今までどおりspeech.cppで読む。

| エンジン | 既定のURL | 使うAPI |
|---|---|---|
| VOICEVOX、SHAREVOX、AivisSpeech | `127.0.0.1`の50021、50025、10101 | `GET /version`、`GET /speakers`、`POST /audio_query`、`POST /synthesis`（`native/tts/src/engines.rs`） |
| COEIROINK v2 | `127.0.0.1:50032` | `GET /v1/engine_info`、`GET /v1/speakers_path_variant`、`POST /v1/synthesis`（`native/tts/src/engines.rs`） |

- 読み上げる文は文末（`。`、`！`、`？`など）と改行で分け、40文字を超える文は読点でも分ける。1つずつ合成し、読み上げている間に次の文を合成する（`native/tts/src/engines.rs`）。エンジンは文ごとにWAVをまとめて返すので、分けないとマイクの読み上げが5秒の開始期限に間に合わない。
- VOICEVOX系では`/audio_query`の応答を`/synthesis`へ渡す。書き換えるのは、下の表で既定から変えたScaleの値だけである（ADR-008の5.2）。AivisSpeechはほかの部分を書き換えた問い合わせを受け付けないことがあるため。4つとも既定のままなら、応答のバイト列をそのまま渡す。COEIROINKの話者の一覧には画像を含まない`/v1/speakers_path_variant`を使う。`/v1/speakers`は画像をbase64で含み、話者1人で約1 MBになる。
- 選んだ声はエンジンのID（COEIROINKは`speakerUuid:styleId`）と話者名、スタイル名で保存する。IDが見つからないか、IDの声の名前が変わっていれば名前で探し直す。見つからなければ`tts_engine_voice_missing`、声を選んでいなければ`tts_engine_voice_unset`、エンジンに接続できなければ`tts_engine_not_ready`で失敗する。歌うためのスタイルは一覧に出さない。
- COEIROINKの`/v1/synthesis`には声の設定（`VOICE_SETTINGS`）の7つの値を送る。値は文字列の10進数で保存し、範囲外や`1e0`のような書き方は保存しない。

  | 設定 | 送る項目 | 範囲 | 既定 |
  |---|---|---|---|
  | `coeiroink_speed` | `speedScale` | 0.5〜2 | `1.0` |
  | `coeiroink_volume` | `volumeScale` | 0〜2 | `1.0` |
  | `coeiroink_pitch` | `pitchScale` | −0.15〜0.15 | `0.0` |
  | `coeiroink_intonation` | `intonationScale` | 0〜2 | `1.0` |
  | `coeiroink_pre_phoneme` | `prePhonemeLength`（秒） | 0〜1.5 | `0.1` |
  | `coeiroink_post_phoneme` | `postPhonemeLength`（秒） | 0〜1.5 | `0.1` |
  | `coeiroink_sampling_rate` | `outputSamplingRate`（Hz） | 16000、24000、44100、48000 | `24000` |

  既定値は設定できるようになる前に固定で送っていた値である。これらのキーがない古い設定は既定値で読む。設定画面ではCOEIROINKを選んだときだけ「COEIROINKの読み方」に7つの値が出る。保存した値は次の読み上げから使う。VOICEVOX系のエンジンには使わない。
- VOICEVOX、AivisSpeech、SHAREVOXの読み方は、声の設定（`VOICE_SETTINGS`）にエンジンごとに4つずつ持つ（`<エンジン>`は`voicevox`、`aivis`、`sharevox`）。値は文字列の10進数で保存し、範囲外や`1e0`のような書き方は保存しない（#392）。

  | 設定 | 書き換える項目 | 範囲 | 既定 |
  |---|---|---|---|
  | `<エンジン>_speed` | `speedScale` | 0.5〜2 | `1.0` |
  | `<エンジン>_volume` | `volumeScale` | 0〜2 | `1.0` |
  | `<エンジン>_pitch` | `pitchScale` | −0.15〜0.15 | `0.0` |
  | `<エンジン>_intonation` | `intonationScale` | 0〜2 | `1.0` |

  既定値はVOICEVOXの`/audio_query`が返す値で、既定のままの項目は書き換えない。範囲はVOICEVOXの画面の調整の範囲である。設定画面では、選んだエンジンの「〈エンジン名〉の読み方」に4つの値が出る。保存した値は次の読み上げから使う。既定のままの項目は`config.json`に書かない。0.5は知らない項目があると`VOICE_SETTINGS`全体を捨てるので、変えていなければ0.5に戻しても声の設定が残る。
- WAVは16ビットのPCMだけを受け付け、約0.2秒ずつに分けて流す。1件の読み上げは60秒まで。エラーには安全なコードだけを使い、読み上げる文、音声、応答の本文を含めない。
- 設定画面（`src-ui/.../tts/TtsEngine.tsx`）は、エンジンを選んだときと「再確認」を押したときに`/get/data/tts_engine_voices`へ`{engine, url, request_id}`を送る。保存前の編集中のエンジンとURLを使い、エンジンには版と声の一覧だけを問い合わせる。文は送らず、合成もしない。応答の`request_id`が最新の問い合わせと同じときだけ画面に使う。声は500件まで返し、保存できない名前やIDの声は除く。
- モデルカタログの外部エンジンのカード（`EngineCatalog.tsx`）も同じエンドポイントで接続できるかを確かめる。保存済みのURL（未設定ならエンジンの既定）を使い、`request_id`は`catalog-`で始める。結果はエンジンごとに持ち、上の欄の問い合わせを置き換えない。保存済みの設定が届いたときに1回と、「再確認」を押したときに問い合わせる。

## デスクトップとの統合

### ウィンドウ

| ラベル | 入口 | 内容 |
|---|---|---|
| `main` | `src-ui/index.html` | メイン画面と設定画面。閉じるとアプリが終わる |
| `quick_chat` | `src-ui/quick-chat.html` | チャット入力の小窓。ホットキーかボタンで開き、閉じても隠すだけで下書きは残る |
| `vr_panel` | `src-ui/vr.html` | VR UI。画面の外（-10000, -10000）に置いて描画し、オーバーレイが取り込む。VR UIがオンの間だけ作る |
| `caption_overlay` | `src-ui/caption-overlay.html` | デスクトップの字幕。最前面に置き、クリックを通し、フォーカスを取らない。Ctrlキーを押している間だけマウスを受け取る（[デスクトップの字幕](use-cases.md)）。字幕か入力と出力の表示がオンの間だけ作る |

設定画面は別ウィンドウではなく、`main`の中のページである。

WindowsのWebView2は、全ウィンドウを同じ起動引数で作る（`src-tauri/tauri.conf.json`の`main`と、`src-tauri/src/lib.rs`の`BROWSER_ARGS`。同じであることはテストで確かめる）。全ウィンドウはアプリが作った1つのWebView2の環境を共有する（[WebView2の通信](#webview2の通信)）。Tauri既定の`--disable-features`から`msSmartScreenProtection`を外し、SmartScreenを既定どおり動かす（第2回セキュリティ監査 SEC-03）。隠れたウィンドウの描画を止める機能（`CalculateNativeWinOcclusion`と、背景での描画の停止）は無効にする。VRパネルを画面の外に置いて撮影するためである。画面と関係なくMicrosoftへ出る通信は`--disable-background-networking`で減らす（[WebView2の通信](#webview2の通信)）。

### WebviewのContent Security Policy（CSP）

`src-tauri/tauri.conf.json`の`app.security.csp`を、上記3ウィンドウの配布用HTMLに共通で適用する。Tauri CLI 2.12.4の`node_modules/@tauri-apps/cli/config.schema.json`にあるdirective map形式を使う（Rust側はTauri 2.12.5）。ブラウザーから読み込む資源の許可であり、Rust/Pythonの通信やTauri capabilityの代わりではない。

| Directive | 許可するsource | 根拠 |
|---|---|---|
| `default-src`、`script-src` | `'self'` | Viteが生成する同一オリジンのJS、共有chunk、modulepreload。i18nextとjs-yamlは同梱された翻訳データを処理する。eval、Functionコンストラクター、Wasmは使わない |
| `style-src` | `'self'`と下記2つのSHA-256 | vanilla-extractが生成したCSSと、依存が実行時に挿入する固定の`<style>`だけ |
| `style-src-attr` | `'none'` | HTMLのstyle属性や`setAttribute("style", …)`は許可しない。Reactの`style` prop、virtua、色選択、倍率・フォント・OCR領域の更新はCSSOMのプロパティ代入を使う |
| `img-src` | `'self' data:` | 同梱PNG/SVG、Viteがインライン化した小画像、選択欄とreact-colorfulのdata SVG。SVGの`?react` importはJS内の要素になる |
| `font-src` | `'self'` | OSにある選択フォントとNoto/systemのフォールバック。現在はフォントファイルの取得も`@font-face`もない。リモートフォントは使わない |
| `connect-src` | `'self' ipc: http://ipc.localhost https://ipc.localhost` | 同一オリジンのmodulepreloadのfetchとTauri IPC。WindowsのHTTP/HTTPS形式も含む。pluginコマンドも同じIPCを通る |
| `media-src`、`worker-src`、`frame-src`、`object-src` | `'none'` | UIに音声・動画プレイヤー、Worker、iframe、objectはない |
| `base-uri` | `'self'` | 別オリジンへの基準URLの変更を禁止 |
| `frame-ancestors`、`form-action` | `'none'` | 埋め込みとHTMLフォームによる送信を禁止 |

`style-src`に加える固定値は、react-colorful 5.8.1の`'sha256-I2px+fnpbN4E5+Djrj7aoTIyq9yyREkuVl19f4Sye9A='`と、react-toastify 11.2.0の`'sha256-wBAOjWqzlHdwhuIyV//yRl4v0VNTHc3TOqbIfNXoA7k='`。依存が実際に挿入するCSS文字列のUTF-8バイトから計算する。配布用に`'unsafe-inline'`、`'unsafe-eval'`、`'wasm-unsafe-eval'`を許可しない。依存を更新して文字列が変わったら、挿入方法とCSS内のURLを確認したうえでハッシュを更新する。

`dangerousDisableAssetCspModification`は既定の`false`を保つ。TauriによるHTMLのnonce/hash挿入を無効化しない。`script-src-elem`を別に指定してTauriの`script-src`への追加を無効にすることもしない。`freezePrototype`は別のprototype汚染対策であり、CSPを有効にする条件ではない。今回は既定の`false`を保つ。

バックエンド（Rustの中核）はアプリの中で動き、UIとはTauriのコマンドとチャネルでつなぐ（0.4まではPython sidecarをshell pluginのstdin/stdoutでつないでいた）。UIは中核のHTTPサーバー、OBS、会話配信用WebSocket、音声サーバーに直接接続しないため、それらのホストやポートを`connect-src`に加えない。OBS用URLはコピーする文字列であり、Tauri内でページを表示しない。モデル取得は同意後に中核（`native/ops`）が実行する（0.4まではPython側）。モデルカード、ライセンス、Aboutの外部リンクはopenerで開く。ログは中核が書く。OCR領域のプレビューはCSSの矩形であり、画面キャプチャ画像を読み込まない。`blob:`、`asset:`、`http://asset.localhost`の許可は不要で、asset protocolも無効のままとする。

`devCsp`だけはViteのReact Refresh用inline script、HMR用style、および`ws://localhost:1420`、`ws://127.0.0.1:1420`、`ws://localhost:1421`、`ws://127.0.0.1:1421`を許す。通常のdev URLは`http://localhost:1420`。`TAURI_DEV_HOST`に別のホストを指定する場合は、開発用のローカルTauri設定で`devCsp.connect-src`にそのホストのHMR URL（ポート1421）を明記する。配布用CSPを広げない。

静的検査は`src-ui/logics/common/contentSecurityPolicy.test.ts`にある。設定、ソースの危険な呼び出しと資源の読み込み、依存のCSSハッシュを検査する。`dist/`があれば、生成JSにeval/Wasm/Workerがないこと、生成CSS/HTMLが同梱資源だけを参照すること、生成JS内のCSSも同じハッシュになることを追加で確かめる。`dist/`がない場合は生成物の検査だけをスキップするため、Viteビルド後にも単独で実行する。静的検査は任意の動的URLのデータフローやWebview実装の挙動までは証明しない。[配布ビルドでのCSP検証](../readme_build.md#配布ビルドでのcsp検証)を別途実行する。

### Tauriのコマンド

| コマンド | 呼べるウィンドウ | 働き |
|---|---|---|
| `get_font_list` | `main` | システムのフォント名の一覧 |
| `vr_panel_send` | `vr_panel` | VRパネルから`main`への知らせ（`vr-panel-ready`、`vr-panel-config-page`、`vr-panel-stdout`）を`main`へ送る。呼び出し元が`vr_panel`であること、イベント名がこの3つであること、ペイロードの形（`null`、真偽値、`path`が文字列のオブジェクト）を確かめ、合わなければ`vr_panel_state_forbidden`か`vr_panel_event_invalid`を返す。VRパネルはイベントを送る権限を持たないので、Rustや別のウィンドウが送るイベントを装えない。Linuxでは、作ったウィンドウを表示せず、中のページをデスクトップに出ない場所へ移してバックエンドへ渡す（[VR画面の受け渡し](use-cases.md)） |
| `main_window_restore` | `main` | 最小化したメイン画面を戻して前面に出す。Waylandでは最小化の状態をアプリが知れず、ポータルのホットキーには前面に出す権利もないため、UIが最小化したことを覚えておき、戻すときはKWinに頼む |
| `quick_chat_show`、`quick_chat_configure`、`quick_chat_take`、`quick_chat_finish`、`quick_chat_shortcut_platform` | `main` | 小窓を開く、設定を渡す、送信要求を受け取る、結果を返す、ホットキーの登録方法を調べる |
| `quick_chat_context`、`quick_chat_submit`、`quick_chat_hide` | `quick_chat` | 設定を読む、送信を頼む、隠す |
| `portal_shortcuts_bind` | `main` | Waylandでホットキーを登録する（180秒で打ち切り）。今のセッションを閉じてから登録し直すので、確認画面でのキャンセル、時間切れ、失敗で終わったときは、エラーを返したあとで直前に効いていた組を登録し直す。それより新しい登録の要求が来ていれば、登録し直さない |
| `screencast_support` | `main` | `{supported, active}`。ウィンドウを共有できるデスクトップか（LinuxのWaylandセッション）、いま共有中か。何も始めない |
| `screencast_start` | `main` | デスクトップにウィンドウの共有を頼む（[ウィンドウの共有](#ウィンドウの共有linux)）。引数は保存済みの`restoreToken`（なければ`null`）。成功すると`{restore_token}`を返す。共有中に呼ぶと、前の共有を終えてから頼む。選択画面の待ち時間は180秒 |
| `screencast_stop` | `main` | 共有を終え、ヘルパーを止め、ポータルのセッションを閉じる |
| `app_update_info` | `main` | `{kind, mode, channel, current_version, package_manager}`。このコピーの入れ方と、更新でできること（[アプリの更新](#アプリの更新)）。通信しない |
| `app_update_check` | `main` | 新しい版を問い合わせ、`{available, version, release_url}`を返す。失敗は`update_check_failed`、`update_metadata_missing`などのコード |
| `app_update_install` | `main` | 最後に問い合わせたチャンネルの確認で見つけた版を取得し、署名を確かめて入れる。進み具合は引数のチャンネル（`{phase: "download", downloaded, total}`、`{phase: "install"}`）で知らせる。Windowsではインストーラーに引き継いで終了し、Linuxでは再起動する。失敗したときは今の版のまま、コードを返す。Windowsでインストーラーの前に中核を止めた後にインストーラーを起動できなかったときは、`app-update-restarting`で知らせてから5秒後に今の版のまま再起動する（#561） |
| `caption_overlay_supported`、`caption_overlay_set`、`caption_overlay_update` | `main` | 字幕のウィンドウを使えるか調べる、開く・閉じる、描く内容を渡す。`caption_overlay_set`は`{open, position, placement}`を取る。`placement`は保存した左上の位置（物理ピクセル、`{x, y}`、各±100000以内）か`null`で、その位置の一部（縦横64ピクセル以上）がどれかのモニターの作業領域に残っていればそこに出し、残っていなければ`position`の帯に出す |
| `caption_overlay_snapshot` | `caption_overlay` | 描く内容を読む。Ctrlキーで調整している間は`adjusting: true`が付く。`main`が渡した`adjusting`は捨てる |

Quick Chatのコンテキストは、`ready`、`language`、`enter_to_send`、`clear_on_send`に加え、保存済みの`ui_scaling`（整数、40〜200%）と`font_family`（空白だけではなく、制御文字を含まない256文字以内のローカルフォント名）を持つ。Rustは呼び出し元と値を検証してから置き換える。新しい2項目を省略した要求は100%と`Yu Gothic UI`を使う。小窓はフォント名をCSSの文字列として扱い、既存のNoto／システムフォントへのフォールバックを保つ。設定ファイルのキーやPython側のIPC形式は変更しない。

VRパネルの要求は`main`が中継する（セキュリティ監査 SEC-02）。中継するのは、VRパネルが実際に送る操作として`VR_PANEL_RELAY_PATHS`（`src-ui/logics/common/vrPanelWire.ts`）に載せたものだけで、載っていない操作は新しいエンドポイントも含めて中継しない。載せているのは、VRパネル自身の窓と操作バー、ランチャーの4つのスイッチ、言語の窓、VRの設定の窓が変える設定（デバイスとしきい値、翻訳・音声認識・チャット読み取りの選択、AI翻訳のモデルの選択、音声認識の区切りの秒数と最大語数、VRChatのチャットボックスのスイッチ、メッセージの変換、VRの字幕、表示言語とフォント）である。アプリの終了と更新、ファイルを開く操作、モデルや実行環境の取得、認証キーとトークン、接続先（URL、WebSocket・OBS・OSCのホストとポート、証明書）、音声の設定、テレメトリの有効化と同意は載せない。`main`は中継する要求に`"origin": "vr_panel"`を付け、バックエンドも同じ一覧（`native/core/src/dispatch.rs`の`vr_panel_endpoints`）で確かめる。一覧にない要求は解釈せず、403と`vr_panel_request_refused`を返す。`origin`のない要求は`main`自身のもので、`vr_panel`以外の`origin`は拒否する。3つの一覧が同じことは試験で確かめる。イベントを送る権限を持つのは`main`のウィンドウだけである（`src-tauri/capabilities`）。VRパネルが持つのはイベントを聞く権限だけで、`vr-panel-stdout`などの3つのイベントは`vr_panel_send`に渡し、Rustが`main`へ送る（[ウィンドウ間の連携](#ウィンドウ間の連携)）。VRパネルへ写す状態にも、認証キーとトークンは入れない（[VRパネルへ写す状態](#vrパネルへ写す状態)）。ウィンドウの共有を戻すトークン（`ocr_portal_restore_token`）も、中継と写しの対象から外す。

### ウィンドウ間の連携

| イベント | 向き | 内容 |
|---|---|---|
| `quick-chat-requested` | Rust → `main` | 小窓から送信の要求が来た。`main`は`quick_chat_take`で受け取り、`/run/send_message_box`で送る |
| `quick-chat-result` | Rust → `quick_chat` | `{id, accepted}`。同じIDの再送には前の結果を返す |
| `quick-chat-opened` | Rust → `quick_chat` | 入力欄にフォーカスを戻す |
| `quick-chat-context-changed` | Rust → `quick_chat` | 設定が更新された。ペイロードは使わず、`quick_chat_context`で検証済みの設定を読み直す。フォーカスは移動しない |
| `portal-shortcut` | Rust → `main` | Waylandでホットキーが押された |
| `portal-shortcuts-lost` | Rust → `main` | Waylandでホットキーを預けたポータルのセッションが、アプリが頼んでいないのに終わった（ポータルの停止や再起動）。ペイロードはない。`main`は通知を出し、3秒後に1回だけ登録し直す。1分以内にまた切れたときは登録し直さず、設定を開いて閉じるよう案内する |
| `portal-shortcuts-not-restored` | Rust → `main` | Waylandでポータルへの登録が失敗し、前に登録していたキーも登録し直せなかった。どのホットキーも効かない。ペイロードはない。`main`は、登録の失敗の知らせに続けて「前のキーにも戻せなかった」と知らせ、設定を開いて閉じるよう案内する。より新しい登録が始まっていたときは送らない。ホットキーを止めている間（設定を開いているときなど）に届いたときは、知らせない（#561） |
| `app-update-restarting` | Rust → `main` | 更新でインストーラーの前に中核を止めたあと、インストーラーを起動できなかった（#561）。ペイロードはない。`main`は中核の停止の知らせを閉じ、「更新を入れられませんでした。今の版のままASTAROTを再起動します。」と知らせる。アプリは5秒後に今の版のまま再起動する。利用者が頼んでいない再起動なので、先に知らせる |
| `vr-panel-ready` | `vr_panel` → Rust（`vr_panel_send`） → `main` | VRパネルの準備ができた。`main`は状態を送り直す |
| `vr-panel-stdout` | `vr_panel` → Rust（`vr_panel_send`） → `main` | VRパネルからの要求。`main`が許可したものだけをサイドカーへ渡す |
| `vr-panel-config-page` | `vr_panel` → Rust（`vr_panel_send`） → `main` | VR内の設定を開いた・閉じた |
| `vr-panel-pointer` | `main` → 全体 | VR内のポインタの位置 |
| `caption-overlay-changed` | Rust → `caption_overlay` | 描く内容か調整中の状態が変わった。ペイロードは使わず、`caption_overlay_snapshot`で読み直す |
| `caption-overlay-moved` | Rust → `main` | Ctrlキーを押したままのドラッグが終わった。`{x, y}`はウィンドウの左上（物理ピクセル）。`main`は`/set/data/overlay_desktop_placement`で保存する |
| `caption-overlay-font-step` | Rust → `main` | 字幕の上でCtrlキーと「+」か「-」が押された。`1`か`-1`。`main`は文字の大きさを2pxずつ16〜72pxの範囲で変え、`/set/data/overlay_desktop_settings`で保存する |

#### VRパネルへ写す状態

画面の状態は、イベントではなくVRパネルが開いたチャンネルで送る（セキュリティ監査 SEC-03、`src-tauri/src/vr_panel_state.rs`）。状態には会話ログが入る。イベントは聞く権限を持つほかのウィンドウ（字幕のオーバーレイとQuick Chat）にも届き、宛先を指定したイベントも、宛先を限らずに聞いているリスナーには届く。チャンネルのメッセージは、それを開いたウェブビューにだけ届く。

- VRパネルは起動すると`vr_panel_state_subscribe`にチャンネルを渡し、受け付けられたら`vr-panel-ready`を送る。受け付けるのは`vr_panel`のウィンドウからの呼び出しだけで、開き直したパネルのチャンネルが前のものに替わる。
- `main`は`vr_panel_state_push`で状態を送る。受け付けるのは`main`からの呼び出しだけ。購読しているパネルがなければ`false`を返し、次の会話ログは全件で送る。パネルのウィンドウを閉じるとチャンネルを捨てる。
- 送るのは、VRパネルの画面が読む状態だけ（`src-ui/logics/common/vrPanelWire.ts`の`vrPanelStateNames`）。設定は、VRパネルが丸ごと読むカテゴリ（表示、デバイス、翻訳、音声認識、チャット読み取り、VR、その他）のもの。そのほかは会話ログ、ランチャーと言語の窓の状態（前提が足りないスイッチとその理由の識別子を含む）、メーター、入力と出力の表示など、名前で挙げたatomだけ。高度な設定（WebSocket、OBS、OSC、テレメトリ）、更新、ホットキーは送らない。認証キーとトークンは、カテゴリに入っていても送らない。VRパネルのコードが新しいatomを読むようになると、ソースを読む試験（`src-ui/logics/test/vrPanelStateScan.ts`）が一覧に足すまで失敗する。
- 利用者が追加したローカル翻訳モデルは、重みのIDと表示名の組を送る。カタログの項目やAPIのURLはメイン画面に留める。
- 会話ログだけは前に送ったログとの差分で送る。通し番号が合わなければ、VRパネルが`vr-panel-ready`で全件を頼み直す。

VRパネルで会話ログを閉じている間も、状態の受信とログの更新は続ける。閉じた領域は描画せず、操作も受け付けない。ログ本体の購読を外し、開き直すと保存した表示位置と末尾への追従状態を戻す。上へスクロールして読んでいた場合はその位置を保ち、それ以外は最新の末尾に追従する。保存中に古い行が保持上限を超えた場合は、通常のログ更新と同じように位置を補正する。

レーザーの位置は最後の`vr-panel-pointer`を保持し、パネル内のスクロール、表示内容の差し替え、レイアウトの変更でもホバー対象を調べ直す。判定は1フレームに1回にまとめ、対象が変わらなければ`data-vr-hover`を書き換えない。ポインタがなくなったらホバー表示を解除する。

### ウィンドウの共有（Linux）

チャット読み取りのために、利用者が選んだウィンドウ1つの映像を受け取る（[UC-05](use-cases.md)）。`screencast_start`を呼ぶのは、次の2つのときだけである。利用者が設定ページのボタンを押したとき。利用者がチャット読み取りをオンにし、読み取れるウィンドウが名前で見つからず、前に共有したウィンドウをデスクトップが覚えているとき（UC-05の「オンにしたときの共有のやり直し」）。起動時には呼ばない。

| 相手 | やりとり |
|---|---|
| XDG ScreenCast portal（`org.freedesktop.portal.ScreenCast`） | Tauriが専用のD-Bus接続で、アプリIDの登録、`CreateSession`、`SelectSources`、`Start`、`OpenPipeWireRemote`の順に呼ぶ。`SelectSources`にはウィンドウだけ（`types: 2`）、1つだけ（`multiple: false`）、ポインターを映さない（`cursor_mode: 1`、対応しているとき）、選んだ結果を覚える（`persist_mode: 2`、ポータルの版が4以上のとき）、保存済みの`restore_token`を渡す。ポータルの応答が1（取り消し）なら`portal_cancelled`、そのほかの失敗は`portal_request_failed`、ウィンドウの共有に対応していなければ`screencast_unsupported` |
| `astarot-screen-capture`（`native/screen-capture`） | Tauriが`OpenPipeWireRemote`の接続を標準入力として渡して起動する。引数は親のプロセスID、PipeWireのノードID、フレームファイルの場所、間隔（250ミリ秒）。メモリーのバッファーだけを受け付け（DMA-BUFは使わない）、形式はBGRx、BGRA、RGBx、RGBA。デスクトップには最大で毎秒4枚を頼み、明らかに早く届いた分は捨てる。標準出力のパイプをTauriが閉じるか、Tauriが終了すると止まる。標準エラーに`streaming`と、止まった理由（`screen_capture_<理由>`）を1行ずつ出す |
| フレームファイル | `$XDG_RUNTIME_DIR/astarot/vr-panel-<pid>/screen-frame`（ディレクトリは0700、ファイルは0600）。先頭64バイトはリトルエンディアンで、目印`ASTRSCR1`、通し番号（書き換え中は奇数）、識別番号（共有が終わると0。上位32ビットはヘルパーのプロセスID）、幅、高さ、1行のバイト数、画素の並び（0: BGRx、1: BGRA、2: RGBx、3: RGBA）、フレームの時刻。続けて画素を置く。最後の行は幅×4バイトだけを持つ。バックエンドは通し番号が読む前後で同じ偶数のときだけ使い、ファイルがない、識別番号が0、ヘルパーのプロセスがない、のどれかなら共有は終わったとみなす |

変化のないウィンドウは新しいフレームを送らないので、フレームが古いことだけでは共有の終わりと判断しない。

| イベント | 向き | 内容 |
|---|---|---|
| `screencast-ended` | Rust → `main` | アプリが止めたのではない共有の終わり。`{reason}`は`ended`（ウィンドウが閉じた、デスクトップ側で共有を止めた）か`failed`（ヘルパーやポータルが止まった）。`main`は共有の表示を戻し、お知らせを出す |

`RunEvent::Exit`で共有を終える。ヘルパーは親が消えたときにも止まるので、アプリが強制終了しても残らない。

### ホットキー

- 動作は9つ: 小窓を開く、ASTAROTの最小化と再表示、翻訳・マイク・スピーカーのオンオフ、読み上げの停止、音声のミュートと再開、TTSとRVCのオンオフ。既定ではどれも割り当てない。
- 読み上げの停止、ミュート、TTS、RVCのホットキーは、メイン画面の同じボタンとスイッチを押したのと同じ処理を通る。押した時点の状態で判断し、同じ確認とお知らせが出る。ミュート中に経路の準備ができていなければ、再開はしない。
- X11とXWaylandではTauriのグローバルショートカット、ネイティブのWaylandではXDG GlobalShortcuts portalで登録する。KDEでは設定したキーをデスクトップ側にも反映し、反映できなかったときはお知らせを出す。
- ポータルでの登録が失敗したとき（確認画面で断った、時間切れ、ポータルの失敗）は、前に登録していたキーを新しいセッションで登録し直す。前のセッションは新しい登録の前に閉じているので、そのままではすべてのキーが消えるためである（#423）。デスクトップが確認画面を出すのは、まだ見ていない動作を含む登録のときだけである。登録し直すのは前に成功した登録の動作なので、確認画面はもう一度出ない（KDE Plasma 6.8 と GNOME 51 で確かめた。#561）。新しいセッションで登録してから古いセッションを閉じる方法は使わない。KDEでは、同じ動作を持つ2つのセッションのどちらかを閉じると、その動作のキーが効かなくなる。登録し直しも失敗したときは、そのことを知らせる（`portal-shortcuts-not-restored`）。
- 設定画面を開いている間と、サイドカーの準備ができるまでは無効にする。
- デスクトップの字幕の文字の大きさを変えるキー（Ctrlと`=`、Ctrl+Shiftと`=`、Ctrlとテンキーの`+`、Ctrlと`-`、Ctrlとテンキーの`-`）は、Ctrlキーを押したまま字幕のウィンドウの上にマウスがあるか、ドラッグしている間だけ、Rustがグローバルショートカットとして登録する。それ以外のときはほかのアプリに届く。利用者がホットキーに割り当て済みのキーは登録しない。

### 権限

`src-tauri/capabilities/`で、`main`にウィンドウ操作、ショートカット、許可したサイトを開くことを許す。ファイル、HTTP、プログラムの起動（shell）のプラグインはアプリに入っていない。バックエンドの`backend_*`コマンドは`main`だけが呼べることをRust側で確かめる。`quick_chat`にはイベントの受信だけを許し、コマンドは呼び出し元のウィンドウ名をRust側で確かめる。

ブラウザーでURLを開けるのは`main`だけで、開けるのは`vrct_capability.json`の`opener:allow-open-url`に挙げたURLだけである（第2回セキュリティ監査 SEC-02）。同じウィンドウに当たる権限は合わさるので、`opener:default`のような広い権限はどのファイルにも入れない。一覧には、アプリが表示するリンクの行き先を挙げる。ユーザー向けドキュメント、このリポジトリ、元のVRCTとその開発者のページ、APIキーを作るページ、Hugging Faceのモデルカード、ライセンスの本文である。`..`を含むパス、パーセントで符号化した`.`と`\`、`@`を含むURLは拒否する。照合はglobで行い、Windowsでは`\`と`/`を同じ文字とみなす。UIに書いたURLと、Pythonのカタログが渡す取得元とライセンスのリンクがどれも一覧に入っていることは、試験で確かめる（`src-ui/logics/common/openerScope.test.ts`、`src-tauri/src/opener_scope_tests.rs`）。新しいリンクを足したら、一覧にも足す。

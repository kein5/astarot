//! What a conversation is doing, and what each thing that happens asks of it. Pure: no I/O and
//! no clock. The session's thread feeds it and carries out what it returns.
//!
//! The service makes an answer's audio faster than it plays. When the user cuts in, the app stops
//! playing it, and the answer's item is cut where the user stopped hearing it
//! (`conversation.item.truncate`), so that the model knows what was said. The app tells how far it
//! played each item; the cut is never past the audio that came.

use crate::protocol::{self, BYTES_PER_MS, ServerEvent, SessionSettings, Status, Turns};
use serde_json::Value;

/// What happens to a conversation.
#[derive(Clone, Debug, PartialEq)]
pub enum Input {
    Server(ServerEvent),
    /// The app played this much of an item's audio, from its start.
    Played { item_id: String, ms: u64 },
    /// The app stops the answer (the user cut in, or pressed stop).
    Interrupt,
    /// The user's turn ends ([`Turns::Manual`] only).
    EndTurn,
}

/// What the app hears of a conversation.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The settings were taken: audio and pictures may be sent.
    Ready,
    /// Audio of an answer to play, in order.
    Audio { item_id: String, pcm: Vec<u8> },
    /// Stop playing the answer and drop what is waiting to play.
    StopPlayback,
    /// What an answer says, as it is spoken.
    Transcript { item_id: String, text: String },
    /// The service heard the user start speaking.
    UserSpeaking,
    /// The service finished an answer (it may still be playing).
    AnswerDone { status: Status },
    /// The service refused something; the conversation goes on.
    ServiceError { code: Option<String> },
}

/// What the conversation asks for.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    Send(Value),
    Tell(Event),
}

/// An answer being made or played.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Answer {
    /// Known from `response.created` (or its first audio).
    pub response_id: String,
    /// The item its audio belongs to, from its first audio.
    pub item_id: Option<String>,
    /// Bytes of audio that came for the item.
    pub received: u64,
    /// Milliseconds of the item the app played.
    pub played_ms: u64,
    /// The service finished sending it.
    pub done: bool,
}

impl Answer {
    fn received_ms(&self) -> u64 {
        self.received / BYTES_PER_MS
    }

    /// Whether some of its audio was not played yet.
    fn unheard(&self) -> bool {
        self.item_id.is_some() && self.played_ms < self.received_ms()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    /// Waiting for the service, then for the settings to be taken.
    Opening { created: bool },
    /// No answer is being made or played.
    Listening,
    Answering(Answer),
}

#[derive(Clone, Debug)]
pub struct Conversation {
    settings: SessionSettings,
    phase: Phase,
    /// The answer stopped last: its late audio is dropped.
    stopped: Option<String>,
}

impl Conversation {
    pub fn new(settings: SessionSettings) -> Conversation {
        Conversation { settings, phase: Phase::Opening { created: false }, stopped: None }
    }

    pub fn phase(&self) -> &Phase {
        &self.phase
    }

    pub fn ready(&self) -> bool {
        !matches!(self.phase, Phase::Opening { .. })
    }

    pub fn step(&mut self, input: Input) -> Vec<Effect> {
        match input {
            Input::Server(event) => self.on_server(event),
            Input::Played { item_id, ms } => self.on_played(&item_id, ms),
            Input::Interrupt => self.interrupt(true),
            Input::EndTurn => self.end_turn(),
        }
    }

    fn on_server(&mut self, event: ServerEvent) -> Vec<Effect> {
        if let Phase::Opening { created } = &mut self.phase {
            return match event {
                // The settings go once the service is there.
                ServerEvent::SessionCreated if !*created => {
                    *created = true;
                    vec![Effect::Send(protocol::session_update(&self.settings))]
                }
                ServerEvent::SessionUpdated => {
                    self.phase = Phase::Listening;
                    vec![Effect::Tell(Event::Ready)]
                }
                ServerEvent::Error { code } => vec![Effect::Tell(Event::ServiceError { code })],
                _ => Vec::new(),
            };
        }
        match event {
            ServerEvent::SessionCreated | ServerEvent::SessionUpdated | ServerEvent::SpeechStopped | ServerEvent::Other => Vec::new(),
            ServerEvent::Error { code } => vec![Effect::Tell(Event::ServiceError { code })],
            ServerEvent::SpeechStarted => {
                // The service cancels the answer being made by itself (`interrupt_response`); what
                // is left to do is stopping what plays and cutting the item there.
                let mut effects = vec![Effect::Tell(Event::UserSpeaking)];
                effects.extend(self.interrupt(false));
                effects
            }
            ServerEvent::ResponseCreated { response_id } => {
                // An answer that comes while one still plays (one the app asked for) replaces it.
                let effects = self.interrupt(false);
                self.phase = Phase::Answering(Answer { response_id, ..Answer::default() });
                effects
            }
            ServerEvent::Audio { response_id, item_id, pcm } => self.on_audio(response_id, item_id, pcm),
            ServerEvent::Transcript { item_id, text } => match &self.phase {
                Phase::Answering(answer) if answer.item_id.as_deref().is_none_or(|current| current == item_id) => {
                    vec![Effect::Tell(Event::Transcript { item_id, text })]
                }
                _ => Vec::new(),
            },
            ServerEvent::ResponseDone { response_id, status } => {
                if let Phase::Answering(answer) = &mut self.phase
                    && (answer.response_id.is_empty() || answer.response_id == response_id)
                {
                    answer.done = true;
                    if !answer.unheard() {
                        self.phase = Phase::Listening;
                    }
                }
                vec![Effect::Tell(Event::AnswerDone { status })]
            }
        }
    }

    fn on_audio(&mut self, response_id: String, item_id: String, pcm: Vec<u8>) -> Vec<Effect> {
        if pcm.is_empty() || self.stopped.as_deref() == Some(response_id.as_str()) {
            return Vec::new();
        }
        let mut effects = Vec::new();
        let another = match &self.phase {
            Phase::Answering(answer) => !answer.response_id.is_empty() && answer.response_id != response_id,
            _ => true,
        };
        if another {
            // `response.created` was not seen: the audio starts the answer, and replaces one that
            // still plays.
            effects = self.interrupt(false);
            self.phase = Phase::Answering(Answer { response_id: response_id.clone(), ..Answer::default() });
        }
        let Phase::Answering(answer) = &mut self.phase else { unreachable!("set above") };
        if answer.response_id.is_empty() {
            answer.response_id = response_id;
        }
        if answer.item_id.as_deref() != Some(item_id.as_str()) {
            // A new item of the answer: its own count.
            answer.item_id = Some(item_id.clone());
            answer.received = 0;
            answer.played_ms = 0;
        }
        answer.received += pcm.len() as u64;
        effects.push(Effect::Tell(Event::Audio { item_id, pcm }));
        effects
    }

    fn on_played(&mut self, item_id: &str, ms: u64) -> Vec<Effect> {
        let Phase::Answering(answer) = &mut self.phase else { return Vec::new() };
        if answer.item_id.as_deref() != Some(item_id) {
            return Vec::new();
        }
        answer.played_ms = answer.played_ms.max(ms.min(answer.received_ms()));
        if answer.done && !answer.unheard() {
            self.phase = Phase::Listening;
        }
        Vec::new()
    }

    /// Stops the answer: what plays stops and the item is cut where it was heard. `cancel` also
    /// asks the service to stop making it, when it still does.
    fn interrupt(&mut self, cancel: bool) -> Vec<Effect> {
        if !matches!(self.phase, Phase::Answering(_)) {
            return Vec::new();
        }
        let Phase::Answering(answer) = std::mem::replace(&mut self.phase, Phase::Listening) else { unreachable!("checked above") };
        let mut effects = Vec::new();
        if cancel && !answer.done {
            effects.push(Effect::Send(protocol::cancel_response()));
        }
        if answer.unheard() {
            effects.push(Effect::Tell(Event::StopPlayback));
            if let Some(item_id) = &answer.item_id {
                effects.push(Effect::Send(protocol::truncate(item_id, answer.played_ms)));
            }
        }
        if !answer.done {
            self.stopped = Some(answer.response_id);
        }
        effects
    }

    fn end_turn(&mut self) -> Vec<Effect> {
        if self.settings.turns != Turns::Manual || !self.ready() {
            return Vec::new();
        }
        vec![Effect::Send(protocol::commit()), Effect::Send(protocol::create_response(&self.settings.instructions))]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manual() -> SessionSettings {
        SessionSettings { instructions: "Be brief.".into(), voice: None, turns: Turns::Manual }
    }

    fn ready(settings: SessionSettings) -> Conversation {
        let mut conversation = Conversation::new(settings.clone());
        assert_eq!(conversation.step(Input::Server(ServerEvent::SessionCreated)), vec![Effect::Send(protocol::session_update(&settings))]);
        assert_eq!(conversation.step(Input::Server(ServerEvent::SessionUpdated)), vec![Effect::Tell(Event::Ready)]);
        conversation
    }

    /// `ms` milliseconds of audio of `item` in `response`.
    fn audio(response: &str, item: &str, ms: u64) -> Input {
        Input::Server(ServerEvent::Audio { response_id: response.into(), item_id: item.into(), pcm: vec![0; (ms * BYTES_PER_MS) as usize] })
    }

    fn sent(effects: &[Effect]) -> Vec<Value> {
        effects.iter().filter_map(|e| if let Effect::Send(v) = e { Some(v.clone()) } else { None }).collect()
    }

    #[test]
    fn nothing_goes_out_before_the_settings_are_taken() {
        let mut conversation = Conversation::new(manual());
        assert!(!conversation.ready());
        assert!(conversation.step(Input::EndTurn).is_empty());
        assert!(conversation.step(audio("r", "i", 10)).is_empty());
        let refused = conversation.step(Input::Server(ServerEvent::Error { code: Some("invalid_value".into()) }));
        assert_eq!(refused, vec![Effect::Tell(Event::ServiceError { code: Some("invalid_value".into()) })]);
        assert!(!conversation.ready());
    }

    #[test]
    fn speech_during_an_answer_stops_it_and_cuts_its_item_where_it_was_heard() {
        let mut conversation = ready(SessionSettings { turns: Turns::server_vad(), ..manual() });
        conversation.step(Input::Server(ServerEvent::ResponseCreated { response_id: "r1".into() }));
        assert_eq!(conversation.step(audio("r1", "item_1", 500)).len(), 1);
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 180 });
        let effects = conversation.step(Input::Server(ServerEvent::SpeechStarted));
        assert_eq!(effects[0], Effect::Tell(Event::UserSpeaking));
        assert!(effects.contains(&Effect::Tell(Event::StopPlayback)));
        // The service cancels the answer itself; only the cut is sent.
        assert_eq!(sent(&effects), vec![json!({ "type": "conversation.item.truncate", "item_id": "item_1", "content_index": 0, "audio_end_ms": 180 })]);
        assert_eq!(conversation.phase(), &Phase::Listening);
        // Audio of the stopped answer that was already on its way is dropped.
        assert!(conversation.step(audio("r1", "item_1", 100)).is_empty());
    }

    #[test]
    fn the_cut_is_never_past_the_audio_that_came() {
        let mut conversation = ready(manual());
        conversation.step(audio("r1", "item_1", 300));
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 299 });
        // A count from another item, or past what came, changes nothing.
        conversation.step(Input::Played { item_id: "item_0".into(), ms: 10 });
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 900 });
        let effects = conversation.step(Input::Interrupt);
        assert_eq!(sent(&effects)[0], json!({ "type": "response.cancel" }));
        // All of it was heard: nothing to stop or cut.
        assert_eq!(sent(&effects).len(), 1);
        assert!(!effects.contains(&Effect::Tell(Event::StopPlayback)));
    }

    #[test]
    fn stopping_an_answer_the_service_still_makes_cancels_it_too() {
        let mut conversation = ready(manual());
        conversation.step(Input::Server(ServerEvent::ResponseCreated { response_id: "r1".into() }));
        conversation.step(audio("r1", "item_1", 400));
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 100 });
        let effects = conversation.step(Input::Interrupt);
        assert_eq!(
            sent(&effects),
            vec![json!({ "type": "response.cancel" }), json!({ "type": "conversation.item.truncate", "item_id": "item_1", "content_index": 0, "audio_end_ms": 100 })]
        );
        // The cancelled answer's end is still told, and nothing waits on it.
        assert_eq!(conversation.step(Input::Server(ServerEvent::ResponseDone { response_id: "r1".into(), status: Status::Cancelled })), vec![Effect::Tell(Event::AnswerDone { status: Status::Cancelled })]);
        assert_eq!(conversation.phase(), &Phase::Listening);
    }

    #[test]
    fn an_answer_ends_once_it_was_made_and_played() {
        let mut conversation = ready(manual());
        conversation.step(Input::Server(ServerEvent::ResponseCreated { response_id: "r1".into() }));
        conversation.step(audio("r1", "item_1", 200));
        let done = conversation.step(Input::Server(ServerEvent::ResponseDone { response_id: "r1".into(), status: Status::Completed }));
        assert_eq!(done, vec![Effect::Tell(Event::AnswerDone { status: Status::Completed })]);
        assert!(matches!(conversation.phase(), Phase::Answering(Answer { done: true, .. })), "it still plays");
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 200 });
        assert_eq!(conversation.phase(), &Phase::Listening);
        // Stopping then has nothing to stop.
        assert!(conversation.step(Input::Interrupt).is_empty());
    }

    #[test]
    fn speech_while_a_finished_answer_still_plays_cuts_it_without_cancelling() {
        let mut conversation = ready(manual());
        conversation.step(audio("r1", "item_1", 1000));
        conversation.step(Input::Server(ServerEvent::ResponseDone { response_id: "r1".into(), status: Status::Completed }));
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 400 });
        let effects = conversation.step(Input::Interrupt);
        assert_eq!(sent(&effects), vec![json!({ "type": "conversation.item.truncate", "item_id": "item_1", "content_index": 0, "audio_end_ms": 400 })]);
    }

    #[test]
    fn the_app_ends_the_turn_only_when_it_has_the_turns() {
        let mut conversation = ready(manual());
        assert_eq!(
            sent(&conversation.step(Input::EndTurn)),
            vec![json!({ "type": "input_audio_buffer.commit" }), json!({ "type": "response.create", "response": { "instructions": "Be brief." } })]
        );
        let mut vad = ready(SessionSettings { turns: Turns::server_vad(), ..manual() });
        assert!(vad.step(Input::EndTurn).is_empty(), "the service ends the turns");
    }

    #[test]
    fn a_new_answer_while_one_plays_stops_the_old_one() {
        let mut conversation = ready(manual());
        conversation.step(audio("r1", "item_1", 600));
        conversation.step(Input::Played { item_id: "item_1".into(), ms: 50 });
        let effects = conversation.step(Input::Server(ServerEvent::ResponseCreated { response_id: "r2".into() }));
        assert!(effects.contains(&Effect::Tell(Event::StopPlayback)));
        assert!(matches!(conversation.phase(), Phase::Answering(Answer { response_id, .. }) if response_id == "r2"));
        assert_eq!(conversation.step(audio("r2", "item_2", 10)).len(), 1);
    }

    #[test]
    fn a_transcript_of_another_item_is_left() {
        let mut conversation = ready(manual());
        conversation.step(audio("r1", "item_1", 10));
        let said = |item: &str| Input::Server(ServerEvent::Transcript { item_id: item.into(), text: "Hi".into() });
        assert_eq!(conversation.step(said("item_1")), vec![Effect::Tell(Event::Transcript { item_id: "item_1".into(), text: "Hi".into() })]);
        assert!(conversation.step(said("item_0")).is_empty());
    }
}

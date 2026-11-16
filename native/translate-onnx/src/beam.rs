//! Beam search with the decoding the app has had from CTranslate2 4.8.4.
//!
//! The rules, for a beam of size B and a target prefix of P tokens. This describes the
//! behaviour; it is not a port of that code.
//!
//! - The decoder starts from the start token. The prefix (the target language) is forced:
//!   the first beam takes it at no cost and the other beams never win.
//! - Each step takes the 2·B best continuations over all beams, by total log-probability.
//! - On the first free step, an end token among the continuations other than the best one
//!   is replaced by a continuation that can never win. The best one may end the sentence.
//! - Of the first B continuations, one that ends the sentence is recorded as a hypothesis,
//!   and its place goes to the next of the remaining B that does not end it.
//! - The search ends once B hypotheses are recorded, or after `max_length` tokens, where the
//!   B continuations of that step are recorded as they are.
//! - A hypothesis holds the prefix, the text and its end token. Its score is its total
//!   log-probability divided by its number of tokens. The best score wins.

/// What the search asks of a model: the scores of every next token for each beam.
pub trait Scorer {
    type Error;

    /// The number of token ids.
    fn vocabulary(&self) -> usize;

    /// The unnormalized scores (logits) of the next token, `tokens.len() × vocabulary` row
    /// by row. Beam `i` continues the earlier beam `origins[i]` with `tokens[i]`. The first
    /// call has a single beam: the start token, with origin 0.
    fn step(&mut self, tokens: &[u32], origins: &[usize]) -> Result<Vec<f32>, Self::Error>;
}

#[derive(Clone, Debug)]
pub struct Search {
    pub beam_size: usize,
    /// The most tokens a hypothesis has, prefix and end token included.
    pub max_length: usize,
    pub start: u32,
    pub end: u32,
    /// Forced first tokens: the target language.
    pub prefix: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Hypothesis {
    /// The prefix, the text and, when the sentence ended, the end token.
    pub tokens: Vec<u32>,
    /// Total log-probability divided by the number of tokens.
    pub score: f32,
}

/// The score of a continuation that can never win.
const NEVER: f32 = -1e10;

/// `logits` turned into log-probabilities in place.
fn log_softmax(logits: &mut [f32]) {
    let highest = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let sum: f32 = logits.iter().map(|value| (value - highest).exp()).sum();
    let offset = highest + sum.ln();
    for value in logits.iter_mut() {
        *value -= offset;
    }
}

/// The `count` highest `(score, index)` of `scores`, best first; of equals, the lower index.
fn top(scores: &[f32], count: usize) -> Vec<(f32, usize)> {
    let mut best: Vec<(f32, usize)> = Vec::with_capacity(count + 1);
    for (index, &score) in scores.iter().enumerate() {
        if best.len() == count && score <= best[count - 1].0 {
            continue;
        }
        let at = best.partition_point(|held| held.0 >= score);
        best.insert(at, (score, index));
        best.truncate(count);
    }
    best
}

/// One continuation: its total log-probability, the beam it continues, its token.
#[derive(Clone, Copy)]
struct Candidate {
    total: f32,
    beam: usize,
    token: u32,
}

/// The best hypothesis. It ends with `settings.end` unless the length limit cut it.
pub fn search<S: Scorer>(scorer: &mut S, settings: &Search) -> Result<Hypothesis, S::Error> {
    let beam_size = settings.beam_size.max(1);
    let max_length = settings.max_length.max(1);
    let candidates = beam_size * 2;
    let vocabulary = scorer.vocabulary();
    let prefix = &settings.prefix;

    // The beams that go on: their tokens so far and their total log-probability.
    let mut sequences: Vec<Vec<u32>> = vec![Vec::new()];
    let mut totals: Vec<f32> = vec![0.0];
    let mut last: Vec<u32> = vec![settings.start];
    let mut origins: Vec<usize> = vec![0];
    let mut finished: Vec<Hypothesis> = Vec::new();

    for step in 0..max_length {
        let mut logits = scorer.step(&last, &origins)?;
        let chosen: Vec<Candidate> = if step < prefix.len() {
            (0..candidates)
                .map(|k| Candidate { total: if k == 0 { 0.0 } else { NEVER }, beam: 0, token: prefix[step] })
                .collect()
        } else {
            for (beam, row) in logits.chunks_mut(vocabulary).enumerate() {
                log_softmax(row);
                for value in row.iter_mut() {
                    *value += totals[beam];
                }
            }
            let mut chosen: Vec<Candidate> = top(&logits, candidates)
                .into_iter()
                .map(|(total, index)| Candidate { total, beam: index / vocabulary, token: (index % vocabulary) as u32 })
                .collect();
            if step == prefix.len() {
                for candidate in chosen.iter_mut().skip(1) {
                    if candidate.token == settings.end {
                        *candidate = Candidate { total: NEVER, beam: 0, token: 0 };
                    }
                }
            }
            chosen
        };
        let extended = |candidate: &Candidate| {
            let mut tokens = sequences[candidate.beam].clone();
            tokens.push(candidate.token);
            tokens
        };

        let last_step = step + 1 == max_length;
        let mut spare = beam_size;
        let mut kept: Vec<usize> = Vec::with_capacity(beam_size);
        for k in 0..beam_size.min(chosen.len()) {
            let mut continues = k;
            if (chosen[k].token == settings.end && step >= prefix.len()) || last_step {
                finished.push(Hypothesis { tokens: extended(&chosen[k]), score: chosen[k].total });
                // Another continuation, one that does not end the sentence, takes this place.
                if let Some(other) = (spare..chosen.len()).find(|other| chosen[*other].token != settings.end) {
                    continues = other;
                    spare = other + 1;
                }
            }
            kept.push(continues);
        }
        if last_step || finished.len() >= beam_size {
            break;
        }
        let next: Vec<Candidate> = kept.iter().map(|index| chosen[*index]).collect();
        sequences = next.iter().map(extended).collect();
        totals = next.iter().map(|candidate| candidate.total).collect();
        last = next.iter().map(|candidate| candidate.token).collect();
        origins = next.iter().map(|candidate| candidate.beam).collect();
    }

    for hypothesis in &mut finished {
        hypothesis.score /= hypothesis.tokens.len() as f32;
    }
    // Of equal scores, the one recorded first.
    let mut best = 0;
    for (index, hypothesis) in finished.iter().enumerate() {
        if hypothesis.score > finished[best].score {
            best = index;
        }
    }
    Ok(finished.swap_remove(best))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A model over a tiny vocabulary whose next-token probabilities depend on the tokens so far.
    struct Table<F: Fn(&[u32]) -> Vec<f32>> {
        vocabulary: usize,
        beams: Vec<Vec<u32>>,
        calls: Vec<(Vec<u32>, Vec<usize>)>,
        probabilities: F,
    }

    impl<F: Fn(&[u32]) -> Vec<f32>> Table<F> {
        fn new(vocabulary: usize, probabilities: F) -> Self {
            Table { vocabulary, beams: Vec::new(), calls: Vec::new(), probabilities }
        }
    }

    impl<F: Fn(&[u32]) -> Vec<f32>> Scorer for Table<F> {
        type Error = ();

        fn vocabulary(&self) -> usize {
            self.vocabulary
        }

        fn step(&mut self, tokens: &[u32], origins: &[usize]) -> Result<Vec<f32>, ()> {
            self.calls.push((tokens.to_vec(), origins.to_vec()));
            // The cache a real decoder keeps: each beam's tokens, reordered by its origin.
            self.beams = tokens
                .iter()
                .zip(origins)
                .map(|(token, origin)| {
                    let mut beam = self.beams.get(*origin).cloned().unwrap_or_default();
                    beam.push(*token);
                    beam
                })
                .collect();
            Ok(self.beams.iter().flat_map(|beam| (self.probabilities)(beam)).map(|p: f32| p.max(1e-30).ln()).collect())
        }
    }

    const START: u32 = 2;
    const END: u32 = 1;
    const LANG: u32 = 4;

    fn settings(beam_size: usize, max_length: usize) -> Search {
        Search { beam_size, max_length, start: START, end: END, prefix: vec![LANG] }
    }

    fn one_hot(size: usize, token: usize) -> Vec<f32> {
        let mut row = vec![0.0; size];
        row[token] = 1.0;
        row
    }

    #[test]
    fn the_prefix_is_forced_and_free_and_the_score_counts_every_token() {
        let mut model = Table::new(6, |beam| match beam.len() {
            1 => vec![1.0; 6], // the start token's row: overridden by the prefix
            2 => one_hot(6, 3),
            _ => one_hot(6, END as usize),
        });
        let best = search(&mut model, &settings(2, 16)).unwrap();
        assert_eq!(best.tokens, [LANG, 3, END]);
        assert!(best.score.abs() < 1e-4, "{}", best.score);
        // The first call has the start token alone; the next has the forced token on every beam.
        assert_eq!(model.calls[0], (vec![START], vec![0]));
        assert_eq!(model.calls[1], (vec![LANG, LANG], vec![0, 0]));
    }

    #[test]
    fn a_likelier_whole_sentence_beats_the_greedy_first_token() {
        let probabilities = |beam: &[u32]| match beam {
            [START] => vec![1.0; 7],
            [START, LANG] => vec![0.0, 0.0, 0.0, 0.55, 0.0, 0.45, 0.0],
            [START, LANG, 3] => vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.5],
            [START, LANG, 5] => one_hot(7, 6),
            _ => one_hot(7, END as usize),
        };
        let best = search(&mut Table::new(7, probabilities), &settings(2, 16)).unwrap();
        assert_eq!(best.tokens, [LANG, 5, 6, END]);
        let greedy = search(&mut Table::new(7, probabilities), &settings(1, 16)).unwrap();
        assert_eq!(greedy.tokens[..2], [LANG, 3]);
    }

    #[test]
    fn on_the_first_free_step_only_the_best_continuation_may_end() {
        // The end is the likeliest first token: the empty sentence is a hypothesis.
        let mut model = Table::new(5, |beam| match beam.len() {
            2 => vec![0.0, 0.9, 0.0, 0.1, 0.0],
            _ => one_hot(5, END as usize),
        });
        let best = search(&mut model, &settings(2, 16)).unwrap();
        assert_eq!(best.tokens, [LANG, END]);
        // The end in second place is not: [LANG, 3, END] is found instead of [LANG, END].
        let mut model = Table::new(5, |beam| match beam.len() {
            2 => vec![0.0, 0.3, 0.0, 0.7, 0.0],
            _ => one_hot(5, END as usize),
        });
        assert_eq!(search(&mut model, &settings(2, 16)).unwrap().tokens, [LANG, 3, END]);
    }

    #[test]
    fn the_length_limit_counts_the_prefix_and_leaves_the_sentence_unended() {
        let mut model = Table::new(5, |_| one_hot(5, 3));
        let best = search(&mut model, &settings(2, 6)).unwrap();
        assert_eq!(best.tokens, [LANG, 3, 3, 3, 3, 3]);
        assert_eq!(model.calls.len(), 6);
    }

    #[test]
    fn an_ended_beam_is_replaced_and_the_search_goes_on_until_enough_ended() {
        // After [LANG, 3] the end is likeliest (0.6), and [LANG, 3, 4, END] exists too.
        let mut model = Table::new(6, |beam| match beam {
            [START] => vec![1.0; 6],
            [START, LANG] => one_hot(6, 3),
            [START, LANG, 3] => vec![0.0, 0.6, 0.0, 0.0, 0.0, 0.4],
            _ => one_hot(6, END as usize),
        });
        let best = search(&mut model, &settings(2, 16)).unwrap();
        // ln(0.6)/3 = -0.170 against ln(0.4)/4 = -0.229: the shorter one wins, after both ended.
        assert_eq!(best.tokens, [LANG, 3, END]);
        assert!((best.score - 0.6f32.ln() / 3.0).abs() < 1e-4);
        assert_eq!(model.calls.len(), 4);
    }
}

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Bound;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

const SNIPPET_CHARS: usize = 140;
const SNIPPET_LEAD_CHARS: usize = 40;
const TYPO_MIN_CHARS: usize = 4;
const TITLE_WEIGHT: u32 = 4;
const TAG_WEIGHT: u32 = 3;
const TEXT_WEIGHT: u32 = 1;
const LINKED_SHOWN: usize = 5;
const EXACT: u32 = 3;
const PREFIX: u32 = 2;
const TYPO: u32 = 1;
const NOTE: &str = "note";
const SOURCE: &str = "source";

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Item {
    pub kind: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub at: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub facts: Vec<String>,
    #[serde(default)]
    pub links: Vec<ItemRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
pub struct ItemRef {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Hit {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub at: String,
    pub url: String,
    pub tags: Vec<String>,
    pub facts: Vec<String>,
    pub linked: Vec<Linked>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Linked {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub at: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Topic {
    pub name: String,
    pub notes: usize,
    pub sources: usize,
}

#[derive(Debug, Clone, Copy)]
struct Posting {
    slot: usize,
    weight: u32,
    text_offset: Option<usize>,
}

#[derive(Debug, Clone, Copy)]
struct Match {
    score: u32,
    text_offset: Option<usize>,
}

#[derive(Debug)]
pub struct Index {
    slots: Vec<Option<Item>>,
    by_ref: BTreeMap<ItemRef, usize>,
    terms: BTreeMap<String, Vec<Posting>>,
    citing: BTreeMap<ItemRef, Vec<usize>>,
}

impl Default for Index {
    fn default() -> Self {
        Self::new()
    }
}

impl Index {
    pub const fn new() -> Self {
        Self {
            slots: Vec::new(),
            by_ref: BTreeMap::new(),
            terms: BTreeMap::new(),
            citing: BTreeMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.by_ref.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_ref.is_empty()
    }

    pub fn put(&mut self, item: Item) {
        let key = ItemRef {
            kind: item.kind.clone(),
            id: item.id.clone(),
        };
        self.forget(&key);
        let slot = self.slots.len();
        let mut postings: BTreeMap<String, Posting> = BTreeMap::new();
        let mut weigh = |word: String, weight: u32, text_offset: Option<usize>| {
            let posting = postings.entry(word).or_insert(Posting {
                slot,
                weight,
                text_offset: None,
            });
            posting.weight = posting.weight.max(weight);
            posting.text_offset = posting.text_offset.or(text_offset);
        };
        for (word, _) in words(&item.title) {
            weigh(word, TITLE_WEIGHT, None);
        }
        for label in item.tags.iter().chain(&item.facts) {
            for (word, _) in words(label) {
                weigh(word, TAG_WEIGHT, None);
            }
        }
        for (word, offset) in words(&item.text) {
            weigh(word, TEXT_WEIGHT, Some(offset));
        }
        for (word, posting) in postings {
            self.terms.entry(word).or_default().push(posting);
        }
        for cited in &item.links {
            self.citing.entry(cited.clone()).or_default().push(slot);
        }
        self.by_ref.insert(key, slot);
        self.slots.push(Some(item));
        self.compact_when_mostly_dead();
    }

    pub fn drop_item(&mut self, key: &ItemRef) {
        self.forget(key);
        self.compact_when_mostly_dead();
    }

    fn forget(&mut self, key: &ItemRef) {
        if let Some(slot) = self.by_ref.remove(key)
            && let Some(held) = self.slots.get_mut(slot)
        {
            *held = None;
        }
    }

    fn compact_when_mostly_dead(&mut self) {
        if self.slots.len() <= 2 * self.len() {
            return;
        }
        let live: Vec<Item> = std::mem::take(&mut self.slots)
            .into_iter()
            .flatten()
            .collect();
        *self = Self::new();
        for item in live {
            self.put(item);
        }
    }

    fn matched(&self, query: &str, kinds: &[String]) -> BTreeMap<usize, Match> {
        let mut needles = words(query).into_iter().map(|(word, _)| word);
        let Some(first) = needles.next() else {
            return BTreeMap::new();
        };
        let mut matched = self.matching(&first, kinds);
        for needle in needles {
            let also = self.matching(&needle, kinds);
            matched = matched
                .into_iter()
                .filter_map(|(slot, m)| {
                    also.get(&slot).map(|other| {
                        let both = Match {
                            score: m.score + other.score,
                            text_offset: m.text_offset.or(other.text_offset),
                        };
                        (slot, both)
                    })
                })
                .collect();
        }
        matched
    }

    pub fn topics(&self, query: &str, limit: usize) -> Vec<Topic> {
        let wanted = topic_key(query);
        if wanted.is_empty() {
            return Vec::new();
        }
        let mut held: BTreeMap<String, (String, usize)> = BTreeMap::new();
        for item in self.slots.iter().flatten() {
            for tag in &item.tags {
                let key = topic_key(tag);
                if !key.split('-').any(|word| word.starts_with(&wanted))
                    && !key.starts_with(&wanted)
                {
                    continue;
                }
                let topic = held.entry(key).or_insert_with(|| (tag.clone(), 0));
                if item.kind == NOTE {
                    topic.1 += 1;
                }
            }
        }
        let sources = [SOURCE.to_string()];
        let mut topics: Vec<(bool, Topic)> = held
            .into_iter()
            .map(|(key, (name, notes))| {
                let topic = Topic {
                    sources: self.matched(&name, &sources).len(),
                    name,
                    notes,
                };
                (key.starts_with(&wanted), topic)
            })
            .collect();
        topics.sort_by(|(a_starts, a), (b_starts, b)| {
            b_starts
                .cmp(a_starts)
                .then_with(|| (b.notes + b.sources).cmp(&(a.notes + a.sources)))
                .then_with(|| a.name.cmp(&b.name))
        });
        topics
            .into_iter()
            .take(limit)
            .map(|(_, topic)| topic)
            .collect()
    }

    pub fn find(&self, query: &str, kinds: &[String], limit: usize) -> Vec<Hit> {
        let matched = self.matched(query, kinds);
        let mut ranked: Vec<(&Item, Match)> = matched
            .into_iter()
            .filter_map(|(slot, m)| self.item(slot).map(|item| (item, m)))
            .collect();
        ranked.sort_by(|(a, ma), (b, mb)| {
            mb.score
                .cmp(&ma.score)
                .then_with(|| b.at.cmp(&a.at))
                .then_with(|| a.title.cmp(&b.title))
        });
        ranked
            .into_iter()
            .take(limit)
            .map(|(item, m)| Hit {
                kind: item.kind.clone(),
                id: item.id.clone(),
                title: item.title.clone(),
                snippet: snippet(&item.text, m.text_offset),
                at: item.at.clone(),
                url: item.url.clone(),
                tags: item.tags.clone(),
                facts: item.facts.clone(),
                linked: self.linked(item),
            })
            .collect()
    }

    fn linked(&self, item: &Item) -> Vec<Linked> {
        let key = ItemRef {
            kind: item.kind.clone(),
            id: item.id.clone(),
        };
        let own = self.by_ref.get(&key).copied();
        let cited = item
            .links
            .iter()
            .filter_map(|link| self.by_ref.get(link).copied());
        let citing = self.citing.get(&key).into_iter().flatten().copied();
        let mut seen = BTreeSet::new();
        cited
            .chain(citing)
            .filter(|slot| Some(*slot) != own && seen.insert(*slot))
            .filter_map(|slot| self.item(slot))
            .take(LINKED_SHOWN)
            .map(|other| Linked {
                kind: other.kind.clone(),
                id: other.id.clone(),
                title: other.title.clone(),
                at: other.at.clone(),
            })
            .collect()
    }

    fn item(&self, slot: usize) -> Option<&Item> {
        self.slots.get(slot).and_then(Option::as_ref)
    }

    fn matching(&self, needle: &str, kinds: &[String]) -> BTreeMap<usize, Match> {
        let mut found = BTreeMap::new();
        for (term, postings) in self.terms_from(needle) {
            if !term.starts_with(needle) {
                break;
            }
            let quality = if term == needle { EXACT } else { PREFIX };
            self.collect(postings, quality, kinds, &mut found);
        }
        if !found.is_empty() || needle.chars().count() < TYPO_MIN_CHARS {
            return found;
        }
        let needle_chars: Vec<char> = needle.chars().collect();
        let Some(initial) = needle_chars.first().map(char::to_string) else {
            return found;
        };
        for (term, postings) in self.terms_from(&initial) {
            if !term.starts_with(&initial) {
                break;
            }
            if one_typo_from_start(&needle_chars, term) {
                self.collect(postings, TYPO, kinds, &mut found);
            }
        }
        found
    }

    fn terms_from(&self, start: &str) -> impl Iterator<Item = (&String, &Vec<Posting>)> {
        self.terms
            .range::<str, _>((Bound::Included(start), Bound::Unbounded))
    }

    fn collect(
        &self,
        postings: &[Posting],
        quality: u32,
        kinds: &[String],
        found: &mut BTreeMap<usize, Match>,
    ) {
        for posting in postings {
            let Some(item) = self.item(posting.slot) else {
                continue;
            };
            if !kinds.is_empty() && !kinds.contains(&item.kind) {
                continue;
            }
            let score = quality * posting.weight;
            let held = found.entry(posting.slot).or_insert(Match {
                score: 0,
                text_offset: None,
            });
            held.score = held.score.max(score);
            held.text_offset = held.text_offset.or(posting.text_offset);
        }
    }
}

fn is_combining_mark(c: char) -> bool {
    ('\u{300}'..='\u{36f}').contains(&c)
}

fn fold_into(c: char, out: &mut String) {
    for lower in c.to_lowercase() {
        match lower {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => out.push('a'),
            'ç' => out.push('c'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ñ' => out.push('n'),
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => out.push('o'),
            'ú' | 'ù' | 'û' | 'ü' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'œ' => out.push_str("oe"),
            'æ' => out.push_str("ae"),
            'ß' => out.push_str("ss"),
            other => out.push(other),
        }
    }
}

fn words(text: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut start = 0;
    for (offset, c) in text.char_indices() {
        if is_combining_mark(c) {
            continue;
        }
        if c.is_alphanumeric() {
            if word.is_empty() {
                start = offset;
            }
            fold_into(c, &mut word);
        } else if !word.is_empty() {
            out.push((std::mem::take(&mut word), start));
        }
    }
    if !word.is_empty() {
        out.push((word, start));
    }
    out
}

fn topic_key(name: &str) -> String {
    let parts: Vec<String> = words(name).into_iter().map(|(word, _)| word).collect();
    parts.join("-")
}

fn one_typo_from_start(needle: &[char], term: &str) -> bool {
    let term: Vec<char> = term.chars().collect();
    [needle.len() - 1, needle.len(), needle.len() + 1]
        .into_iter()
        .filter(|len| *len > 0 && *len <= term.len())
        .any(|len| typos(needle, &term[..len]) <= 1)
}

fn typos(a: &[char], b: &[char]) -> usize {
    let mut before: Vec<usize> = Vec::new();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut row = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            row[j] = (previous[j] + 1)
                .min(row[j - 1] + 1)
                .min(previous[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                row[j] = row[j].min(before[j - 2] + 1);
            }
        }
        before = std::mem::replace(&mut previous, row);
    }
    previous[b.len()]
}

fn snippet(text: &str, offset: Option<usize>) -> String {
    let start = offset.map_or(0, |at| lead_start(text, at));
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    let mut kept = 0;
    let mut spaced = false;
    let shown = text.get(start..).unwrap_or(text);
    let shown = if start > 0 {
        shown.trim_start_matches(|c: char| !c.is_alphanumeric())
    } else {
        shown.trim_start()
    };
    for c in shown.chars() {
        if c.is_whitespace() {
            spaced = kept > 0;
            continue;
        }
        if kept >= SNIPPET_CHARS {
            out.push('…');
            return out;
        }
        if spaced {
            out.push(' ');
            spaced = false;
        }
        out.push(c);
        kept += 1;
    }
    out
}

fn lead_start(text: &str, at: usize) -> usize {
    let Some(head) = text.get(..at) else {
        return 0;
    };
    let back = head
        .char_indices()
        .rev()
        .nth(SNIPPET_LEAD_CHARS - 1)
        .map_or(0, |(offset, _)| offset);
    if back == 0 {
        return 0;
    }
    head.get(back..)
        .and_then(|lead| {
            lead.char_indices()
                .find(|(_, c)| c.is_whitespace())
                .map(|(offset, c)| back + offset + c.len_utf8())
        })
        .unwrap_or(back)
}

static INDEX: Mutex<Index> = Mutex::new(Index::new());

fn held() -> Result<MutexGuard<'static, Index>, String> {
    INDEX
        .lock()
        .map_err(|_| "the index is unavailable".to_string())
}

pub fn replace(items: Vec<Item>) -> Result<usize, String> {
    let mut index = held()?;
    *index = Index::new();
    for item in items {
        index.put(item);
    }
    Ok(index.len())
}

pub fn change(put: Vec<Item>, drop: &[ItemRef]) -> Result<usize, String> {
    let mut index = held()?;
    for key in drop {
        index.drop_item(key);
    }
    for item in put {
        index.put(item);
    }
    Ok(index.len())
}

pub fn find(query: &str, kinds: &[String], limit: usize) -> Result<Vec<Hit>, String> {
    Ok(held()?.find(query, kinds, limit))
}

pub fn topics(query: &str, limit: usize) -> Result<Vec<Topic>, String> {
    Ok(held()?.topics(query, limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: &str, id: &str, title: &str, text: &str, at: &str) -> Item {
        Item {
            kind: kind.into(),
            id: id.into(),
            title: title.into(),
            text: text.into(),
            at: at.into(),
            url: String::new(),
            tags: Vec::new(),
            facts: Vec::new(),
            links: Vec::new(),
        }
    }

    #[test]
    fn a_fact_finds_its_note_and_comes_back_with_it() {
        let mut index = sample();
        let mut note = item("note", "n1", "Budget asso 2027", "", "");
        note.facts = vec!["Statut : En cours".into(), "Échéance : 20 nov.".into()];
        index.put(note);
        let hits = index.find("en cours", &[], 10);
        assert_eq!(ids(&hits), vec!["n1"]);
        assert_eq!(
            hits[0].facts,
            vec!["Statut : En cours", "Échéance : 20 nov."]
        );
        assert_eq!(
            ids(&index.find("echeance", &["note".to_string()], 10)),
            vec!["n1"]
        );
    }

    fn cites(kind: &str, id: &str) -> ItemRef {
        ItemRef {
            kind: kind.into(),
            id: id.into(),
        }
    }

    fn linked_ids(hit: &Hit) -> Vec<&str> {
        hit.linked.iter().map(|l| l.id.as_str()).collect()
    }

    #[test]
    fn a_tag_finds_its_note_between_a_title_and_a_text() {
        let mut index = Index::new();
        index.put(item("note", "text", "Lectures", "une asso de quartier", ""));
        let mut tagged = item("note", "tag", "Budget 2027", "", "");
        tagged.tags = vec!["Asso".into(), "trésorerie".into()];
        index.put(tagged);
        index.put(item("note", "title", "Asso", "", ""));
        let hits = index.find("asso", &[], 10);
        assert_eq!(ids(&hits), vec!["title", "tag", "text"]);
        assert_eq!(hits[1].tags, vec!["Asso", "trésorerie"]);
        assert_eq!(ids(&index.find("tresor", &[], 10)), vec!["tag"]);
    }

    #[test]
    fn a_hit_names_what_it_cites_and_what_cites_it() {
        let mut index = sample();
        let mut note = item("note", "n1", "Budget asso 2027", "", "2026-11-13T10:00:00Z");
        note.links = vec![
            cites("note", "n2"),
            cites("appointment", "a1"),
            cites("reminder", "a1"),
            cites("note", "gone"),
            cites("note", "n1"),
        ];
        index.put(note);

        let hits = index.find("asso 2027", &[], 1);
        assert_eq!(linked_ids(&hits[0]), vec!["n2", "a1"]);
        assert_eq!(hits[0].linked[1].kind, "appointment");
        assert_eq!(hits[0].linked[1].title, "Point budget avec la trésorière");

        let meeting = index.find("tresoriere", &[], 1);
        assert_eq!(linked_ids(&meeting[0]), vec!["n1"]);
        assert!(index.find("appeler marc", &[], 1)[0].linked.is_empty());
    }

    #[test]
    fn a_link_follows_the_note_that_held_it() {
        let mut index = sample();
        let mut note = item("note", "n1", "Budget asso 2027", "", "");
        note.links = vec![cites("appointment", "a1")];
        index.put(note);
        index.put(item("note", "n1", "Budget asso 2027", "", ""));
        assert!(index.find("tresoriere", &[], 1)[0].linked.is_empty());

        let mut again = item("note", "n2", "CR AG 2026", "", "");
        again.links = vec![cites("appointment", "a1")];
        index.put(again);
        index.drop_item(&cites("note", "n2"));
        assert!(index.find("tresoriere", &[], 1)[0].linked.is_empty());
    }

    fn sample() -> Index {
        let mut index = Index::new();
        index.put(item(
            "note",
            "n1",
            "Budget asso 2027",
            "Recettes : cotisations 3 400 €. La ligne communication passe à 1 200 €.",
            "2026-11-13T10:00:00Z",
        ));
        index.put(item(
            "note",
            "n2",
            "CR AG 2026",
            "On a voté le budget prévisionnel de l'association, puis parlé de l'atelier vélo.",
            "2026-10-02T18:30:00Z",
        ));
        index.put(item(
            "appointment",
            "a1",
            "Point budget avec la trésorière",
            "Visio",
            "2026-11-14T14:00:00Z",
        ));
        index.put(item(
            "reminder",
            "r1",
            "Appeler Marc",
            "",
            "2026-11-20T09:00:00Z",
        ));
        index
    }

    fn ids(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    #[test]
    fn finds_by_the_start_of_a_word_whatever_its_case_and_accents() {
        let index = sample();
        assert_eq!(ids(&index.find("TRESOR", &[], 10)), vec!["a1"]);
        assert_eq!(ids(&index.find("prévi", &[], 10)), vec!["n2"]);
        assert_eq!(ids(&index.find("previsionnel", &[], 10)), vec!["n2"]);
    }

    #[test]
    fn reads_accents_written_as_combining_marks() {
        let mut index = Index::new();
        index.put(item("note", "n", "Pre\u{301}visionnel", "", ""));
        assert_eq!(ids(&index.find("prévisionnel", &[], 10)), vec!["n"]);
    }

    #[test]
    fn a_title_outranks_the_text_and_the_newest_wins_a_tie() {
        let index = sample();
        assert_eq!(ids(&index.find("budget", &[], 10)), vec!["a1", "n1", "n2"]);
    }

    #[test]
    fn every_word_must_be_there() {
        let index = sample();
        assert_eq!(ids(&index.find("budget asso", &[], 10)), vec!["n1", "n2"]);
        assert!(index.find("budget piscine", &[], 10).is_empty());
    }

    #[test]
    fn forgives_one_typo_when_nothing_starts_that_way() {
        let index = sample();
        assert_eq!(ids(&index.find("tresoirere", &[], 10)), vec!["a1"]);
        assert_eq!(ids(&index.find("bugdet", &[], 2)), vec!["a1", "n1"]);
        assert!(index.find("bxxget", &[], 10).is_empty());
        assert!(index.find("mxr", &[], 10).is_empty());
    }

    #[test]
    fn keeps_to_the_kinds_asked_and_to_the_limit() {
        let index = sample();
        let moments = ["appointment".to_string(), "reminder".to_string()];
        assert_eq!(ids(&index.find("budget", &moments, 10)), vec!["a1"]);
        assert_eq!(ids(&index.find("budget", &[], 1)), vec!["a1"]);
        assert!(index.find("  ", &[], 10).is_empty());
    }

    #[test]
    fn shows_the_words_around_what_was_found() {
        let mut index = Index::new();
        let text = format!(
            "{} enfin le mot trésorerie arrive ici, {}",
            "avant ".repeat(30),
            "après ".repeat(40)
        );
        index.put(item("note", "n", "Longue note", &text, ""));
        let hits = index.find("tresorerie", &[], 1);
        let snippet = &hits[0].snippet;
        assert!(snippet.starts_with('…'), "{snippet}");
        assert!(snippet.ends_with('…'), "{snippet}");
        assert!(snippet.contains("le mot trésorerie arrive"), "{snippet}");
        assert!(snippet.starts_with("…avant"), "{snippet}");
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 50, "{snippet}");
    }

    #[test]
    fn a_cut_snippet_starts_on_a_word() {
        let mut index = Index::new();
        index.put(item(
            "note",
            "n",
            "Budget",
            "Recettes : cotisations 3 400 €. La ligne communication passe à 1 200 €.",
            "",
        ));
        assert_eq!(
            index.find("communication", &[], 1)[0].snippet,
            "…cotisations 3 400 €. La ligne communication passe à 1 200 €."
        );
    }

    #[test]
    fn a_title_only_match_shows_the_start_of_the_text() {
        let index = sample();
        let hits = index.find("asso 2027", &[], 1);
        assert_eq!(
            hits[0].snippet,
            "Recettes : cotisations 3 400 €. La ligne communication passe à 1 200 €."
        );
    }

    #[test]
    fn a_changed_item_replaces_itself_and_a_dropped_one_is_gone() {
        let mut index = sample();
        index.put(item(
            "note",
            "n1",
            "Trésorerie 2027",
            "",
            "2026-11-13T11:00:00Z",
        ));
        assert_eq!(index.len(), 4);
        assert_eq!(ids(&index.find("asso", &[], 10)), vec!["n2"]);
        assert_eq!(ids(&index.find("tresorerie", &[], 10)), vec!["n1"]);
        index.drop_item(&ItemRef {
            kind: "note".into(),
            id: "n1".into(),
        });
        assert_eq!(index.len(), 3);
        assert!(index.find("tresorerie", &[], 10).is_empty());
    }

    #[test]
    fn stays_right_after_many_rewrites() {
        let mut index = sample();
        for round in 0..50 {
            index.put(item(
                "note",
                "n1",
                &format!("Brouillon {round}"),
                "budget",
                "",
            ));
        }
        assert_eq!(index.len(), 4);
        assert!(index.slots.len() <= 2 * index.len() + 1);
        assert_eq!(ids(&index.find("brouillon 49", &[], 10)), vec!["n1"]);
        assert!(index.find("brouillon 48", &[], 10).is_empty());
        assert_eq!(index.find("budget", &[], 10).len(), 3);
    }

    fn tagged(kind: &str, id: &str, title: &str, tags: &[&str]) -> Item {
        let mut held = item(kind, id, title, "", "");
        held.tags = tags.iter().map(|tag| (*tag).to_string()).collect();
        held
    }

    #[test]
    fn names_the_topics_a_typed_word_starts_with_what_each_holds() {
        let mut index = Index::new();
        index.put(tagged(
            "note",
            "n1",
            "Budget 2027",
            &["budget-prévisionnel"],
        ));
        index.put(tagged(
            "note",
            "n2",
            "CR AG",
            &["Budget-Prévisionnel", "asso"],
        ));
        index.put(tagged("note", "n3", "Idées", &["participatif"]));
        index.put(tagged("source", "s1", "Guide", &["Budget / Prévisionnel"]));
        index.put(tagged(
            "source",
            "s2",
            "Le budget prévisionnel expliqué",
            &[],
        ));

        let topics = index.topics("Budget-prévi", 5);

        assert_eq!(
            topics,
            vec![Topic {
                name: "budget-prévisionnel".into(),
                notes: 2,
                sources: 2,
            }]
        );
        assert_eq!(index.topics("previ", 5).len(), 1);
        assert!(index.topics("", 5).is_empty());
        assert!(index.topics("#", 5).is_empty());
    }

    #[test]
    fn a_topic_only_literature_holds_is_offered_too() {
        let mut index = Index::new();
        index.put(tagged("source", "s1", "Guide", &["Vie asso"]));
        index.put(tagged("note", "n1", "Atelier", &["vélo"]));

        assert_eq!(
            index.topics("vie", 5),
            vec![Topic {
                name: "Vie asso".into(),
                notes: 0,
                sources: 1,
            }]
        );
    }

    #[test]
    fn a_hit_carries_the_address_of_its_page() {
        let mut index = Index::new();
        let mut page = item("source", "s1", "Guide du budget", "", "");
        page.url = "https://example.org/budget".into();
        index.put(page);

        assert_eq!(
            index.find("budget", &[], 5)[0].url,
            "https://example.org/budget"
        );
    }
}

package lyrics

import (
	"slices"
	"sort"
)

// Policy tells Choose how strict to be.
type Policy struct {
	// MinConfidence is the lowest match confidence a candidate may have. Zero
	// means ConfidenceAuto.
	MinConfidence float64
	// ProviderOrder breaks ties between otherwise equal candidates; earlier wins.
	ProviderOrder []string
}

func (p Policy) minConfidence() float64 {
	if p.MinConfidence <= 0 {
		return ConfidenceAuto
	}
	return p.MinConfidence
}

func (p Policy) providerRank(provider string) int {
	for i, name := range p.ProviderOrder {
		if name == provider {
			return i
		}
	}
	return len(p.ProviderOrder)
}

// Eligible keeps the candidates that have lyrics and match the recording well
// enough, in the order Choose prefers them: quality first, then match
// confidence, then provider order. A candidate whose length is far from the
// track's is not eligible however good its score (Match.Verified): better
// synchronization never makes up for another recording.
func Eligible(cands []Candidate, p Policy) []Candidate {
	out := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if c.Quality == QualityNone || c.Match.Confidence < p.minConfidence() || c.Match.DurationDelta > maxVerifiedDurationDelta {
			continue
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Quality != b.Quality {
			return a.Quality > b.Quality
		}
		if a.Match.Confidence != b.Match.Confidence {
			return a.Match.Confidence > b.Match.Confidence
		}
		return p.providerRank(a.Provider) < p.providerRank(b.Provider)
	})
	return out
}

// Choose returns the best eligible candidate. A karaoke result with a doubtful
// match is not eligible, so it can never outrank correct line-synced lyrics.
func Choose(cands []Candidate, p Policy) (Candidate, bool) {
	eligible := Eligible(cands, p)
	if len(eligible) == 0 {
		return Candidate{}, false
	}
	return eligible[0], true
}

// IsUpgrade reports whether replacing the current quality with the candidate is
// an improvement. Equal or lower quality is never an automatic upgrade.
func IsUpgrade(current Quality, c Candidate) bool {
	return c.Quality > current
}

// What the automatic retrieval or upgrade does with a candidate when the track
// plays (Candidate.Auto). Everything but AutoChosen is a reason it is not taken.
const (
	// AutoChosen: it is the version that would be taken.
	AutoChosen = "chosen"
	// AutoOutranked: another candidate would be taken before it.
	AutoOutranked = "outranked"
	// AutoNotBetter: the current lyrics are as well synchronized or better.
	AutoNotBetter = "not-better"
	// AutoMatch: the match with the recording is below the threshold.
	AutoMatch = "match"
	// AutoDuration: its length is too far from the track's.
	AutoDuration = "duration"
	// AutoRights: it may be neither saved nor shown automatically.
	AutoRights = "rights"
	// AutoProviderOff: its provider is not one the automatic retrieval asks.
	AutoProviderOff = "provider-off"
	// AutoLocked: the track's lyrics are locked.
	AutoLocked = "locked"
	// AutoUserChoice: lyrics chosen by hand are never replaced automatically.
	AutoUserChoice = "user-choice"
	// AutoManual: a lyrics file or embedded lyrics, and replacing those is off.
	AutoManual = "manual"
	// AutoOff: automatic retrieval or upgrades are turned off.
	AutoOff = "off"
	// AutoNoLyrics: the result has no lyrics (an instrumental, for instance).
	AutoNoLyrics = "no-lyrics"
)

// autoVerdicts says, for each candidate, what the automatic retrieval or upgrade
// would do with it, by the same rules it follows: gate is the reason the track's
// lyrics are not replaced at all ("" when they may be), current the quality of
// what it shows now and enabled the providers it asks.
func autoVerdicts(cands []Candidate, p Policy, current Quality, gate string, enabled []string) []string {
	var asked []Candidate
	for _, c := range cands {
		if slices.Contains(enabled, c.Provider) {
			asked = append(asked, c)
		}
	}
	chosen := ""
	for _, c := range Eligible(usable(asked, ResolveOptions{}), p) {
		if IsUpgrade(current, c) {
			chosen = c.ID
			break
		}
	}
	out := make([]string, len(cands))
	for i, c := range cands {
		switch {
		case c.Quality == QualityNone:
			out[i] = AutoNoLyrics
		case gate != "":
			out[i] = gate
		case !slices.Contains(enabled, c.Provider):
			out[i] = AutoProviderOff
		case c.Match.Confidence < p.minConfidence():
			out[i] = AutoMatch
		case c.Match.DurationDelta > maxVerifiedDurationDelta:
			out[i] = AutoDuration
		case !c.AutoSave && !c.CanShow && !c.DisplayOnly:
			out[i] = AutoRights
		case !IsUpgrade(current, c):
			out[i] = AutoNotBetter
		case c.ID == chosen:
			out[i] = AutoChosen
		default:
			out[i] = AutoOutranked
		}
	}
	return out
}

// SkippedKaraoke names a word-timed result the automatic retrieval did not take,
// and why (one of the Auto reasons).
type SkippedKaraoke struct {
	Provider   string  `json:"provider"`
	Reason     string  `json:"reason"`
	Confidence float64 `json:"confidence"`
}

// skippedKaraoke returns the best-matching word-timed candidate that was not
// taken, unless a word-timed one was. A result too weak to be offered at all
// (Match.Listed) is not worth naming.
func skippedKaraoke(cands []Candidate, verdicts []string) *SkippedKaraoke {
	var best *SkippedKaraoke
	for i, c := range cands {
		if c.Quality != QualityKaraoke {
			continue
		}
		if verdicts[i] == AutoChosen {
			return nil
		}
		if c.Match.Listed() && (best == nil || c.Match.Confidence > best.Confidence) {
			best = &SkippedKaraoke{Provider: c.Provider, Reason: verdicts[i], Confidence: c.Match.Confidence}
		}
	}
	return best
}

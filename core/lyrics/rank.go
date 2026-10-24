package lyrics

import (
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
// confidence, then provider order.
func Eligible(cands []Candidate, p Policy) []Candidate {
	out := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if c.Quality == QualityNone || c.Match.Confidence < p.minConfidence() {
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

package lyrics

import "context"

// unavailable is a provider Navidrome knows about but cannot use legitimately.
// It exists so the interface can say so honestly. It never makes a request.
type unavailable struct {
	info ProviderInfo
}

func (u unavailable) Info() ProviderInfo { return u.info }

func (u unavailable) Search(context.Context, Recording) ([]Candidate, error) {
	return nil, ErrProviderUnavailable
}

// NewKuGou reports KuGou as unavailable.
func NewKuGou() OnlineProvider {
	return unavailable{ProviderInfo{
		ID: "kugou", Name: "KuGou Music", Status: StatusUnavailable, Verified: false,
		Reason: "KuGou has no public developer API for lyrics. The KRC data comes only from undocumented app endpoints, which this project does not use.",
		Note:   "The KRC word-timed format is not supported.",
	}}
}

// NewNetEase reports NetEase Cloud Music as unavailable.
func NewNetEase() OnlineProvider {
	return unavailable{ProviderInfo{
		ID: "netease", Name: "NetEase Cloud Music", Status: StatusUnavailable, Verified: false,
		Reason: "NetEase offers no public lyrics API. Existing integrations rely on reverse-engineered web endpoints, which this project does not use.",
		Note:   "The YRC word-timed format is not supported.",
	}}
}

// NewAppleMusic reports Apple Music as unavailable for lyrics.
func NewAppleMusic() OnlineProvider {
	return unavailable{ProviderInfo{
		ID: "apple", Name: "Apple Music", Status: StatusUnavailable, Verified: false,
		Reason: "The Apple Music API documents only the hasLyrics flag. The endpoint that returns timed lyrics is private and needs a user's subscription token, so it is not used.",
		Note:   "hasLyrics says whether lyrics exist, not that they can be downloaded.",
	}}
}

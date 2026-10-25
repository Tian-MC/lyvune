package lyrics

import "context"

// unavailable is a provider Lyvune knows about but cannot use legitimately.
// It exists so the interface can say so honestly. It never makes a request.
type unavailable struct {
	info ProviderInfo
}

func (u unavailable) Info() ProviderInfo { return u.info }

func (u unavailable) Search(context.Context, Recording) ([]Candidate, error) {
	return nil, ErrProviderUnavailable
}

// NewAppleMusic reports Apple Music as unavailable for lyrics.
func NewAppleMusic() OnlineProvider {
	return unavailable{ProviderInfo{
		ID: "apple", Name: "Apple Music", Status: StatusUnavailable, Verified: false, Implemented: false, Configured: false, Auth: AuthNone,
		Reason: "The Apple Music API documents only the hasLyrics flag. The endpoint that returns timed lyrics is private and needs a user's subscription token, so it is not used.",
		Note:   "hasLyrics says whether lyrics exist, not that they can be downloaded.",
	}}
}

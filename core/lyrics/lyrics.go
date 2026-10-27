package lyrics

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	. "github.com/Masterminds/squirrel"
	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
	"github.com/Tian-MC/lyvune/persistence"
	"golang.org/x/sync/singleflight"
)

// maxLegacyLyricsCandidates bounds the duplicate window scanned by the legacy
// artist/title lookup, so source-priority resolution can still reach older
// matches without turning it into an unbounded table scan.
const maxLegacyLyricsCandidates = 10

// Provider fetches lyrics for a single media file. It is the contract
// implemented by individual lyrics sources, such as plugins.
type Provider interface {
	GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error)
}

// Lyrics resolves lyrics for media files, honoring the configured source
// priority.
type Lyrics interface {
	Provider
	GetLyricsByArtistTitle(ctx context.Context, artist, title string) (model.LyricList, error)
}

// PluginLoader discovers and loads lyrics provider plugins.
type PluginLoader interface {
	LoadLyricsProvider(name string) (Provider, bool)
}

type lyricsService struct {
	ds           model.DataStore
	pluginLoader PluginLoader

	props     propertyStore
	store     *Store
	providers *Providers
	searches  *searchCache
	health    *healthTracker
	display   *displayCache
	rights    *rightsTable
	flight    singleflight.Group
	// searchFlight lets identical manual searches made at the same time (a
	// double click, two tabs) share one round of provider requests.
	searchFlight singleflight.Group
	now          func() time.Time

	settingsMu    sync.Mutex
	settingsCache Settings
	settingsAt    time.Time

	bulkMu   sync.Mutex
	bulkJobs map[string]*bulkJob
	bulkSeq  int
}

// Options configures a lyrics service. Zero values select the defaults, which
// is what NewLyrics does; tests inject providers and a store.
type Options struct {
	DataStore    model.DataStore
	PluginLoader PluginLoader
	Providers    *Providers
	Store        *Store
	Now          func() time.Time
	// RightsFile is where storage authorizations are read from. Empty selects
	// lyrics-storage-rights.json in the data folder.
	RightsFile string
	// ShareState makes the service use the process-wide display cache and provider
	// health. The application builds one service per router, so without this the
	// lyrics shown after a search would be invisible to the router the player
	// reads from. Tests leave it off to stay isolated.
	ShareState bool
}

// processDisplay and processHealth are the state shared by the services the
// application creates with NewLyrics.
var (
	processDisplay = newDisplayCache()
	processHealth  = newHealthTracker()
)

// NewLyrics creates a new lyrics service. pluginLoader may be nil if no plugin
// system is available.
func NewLyrics(ds model.DataStore, pluginLoader PluginLoader) Lyrics {
	return NewService(Options{DataStore: ds, PluginLoader: pluginLoader, ShareState: true})
}

// NewService creates a lyrics service from explicit options.
func NewService(o Options) Lyrics {
	if o.Providers == nil {
		o.Providers = NewProviders(
			NewLRCLIB(conf.Server.Lyrics.LRCLIB.BaseURL, conf.Server.Lyrics.LRCLIB.Enabled),
			NewMusixmatch("", conf.Server.Lyrics.Musixmatch.ApiKey),
			NewKuGou("", ""),
			NewNetEase(""),
			NewQQ("", "", conf.Server.Lyrics.QQ.BetterLyricsApiKey),
			NewAppleMusic(),
		)
	}
	if o.Store == nil {
		o.Store = NewStore(filepath.Join(conf.Server.DataFolder.String(), "lyrics-history"), conf.Server.Lyrics.HistoryKeep)
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.RightsFile == "" {
		o.RightsFile = filepath.Join(conf.Server.DataFolder.String(), rightsFileName)
	}
	display, health := newDisplayCache(), newHealthTracker()
	if o.ShareState {
		display, health = processDisplay, processHealth
	}
	return &lyricsService{
		ds: o.DataStore, pluginLoader: o.PluginLoader,
		props: propertyStore{ds: o.DataStore}, store: o.Store, providers: o.Providers,
		searches: newSearchCache(), health: health, display: display, rights: newRightsTable(o.RightsFile), now: o.Now, bulkJobs: map[string]*bulkJob{},
	}
}

// GetLyrics returns lyrics for the given media file, trying sources in the
// order specified by conf.Server.LyricsPriority.
func (l *lyricsService) GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	return l.forClients(ctx, cur.list), err
}

// forClients applies the administrator's policy on translation tracks to lyrics
// about to be sent to a player. It returns a new list and leaves the stored
// lyrics untouched.
func (l *lyricsService) forClients(ctx context.Context, list model.LyricList) model.LyricList {
	if l.settings(ctx).ExposeTranslationsToClients {
		return list
	}
	return withoutTranslations(list)
}

// withoutTranslations returns the list without its translation tracks. The
// input is not modified; it is returned as is when there is nothing to drop.
func withoutTranslations(list model.LyricList) model.LyricList {
	if !slices.ContainsFunc(list, isTranslation) {
		return list
	}
	out := make(model.LyricList, 0, len(list))
	for _, l := range list {
		if !isTranslation(l) {
			out = append(out, l)
		}
	}
	return out
}

func isTranslation(l model.Lyrics) bool { return l.EffectiveKind() == model.LyricKindTranslation }

// GetLyricsByArtistTitle resolves lyrics for the legacy artist/title lookup,
// scanning a bounded window of duplicate matches so source priority still wins
// across them.
func (l *lyricsService) GetLyricsByArtistTitle(ctx context.Context, artist, title string) (model.LyricList, error) {
	opts := songsByArtistTitleWithLyricsFirst(artist, title)
	opts.Max = maxLegacyLyricsCandidates
	mediaFiles, err := l.ds.MediaFile().GetAll(ctx, opts)
	if err != nil {
		return nil, err
	}
	if len(mediaFiles) == 0 {
		return nil, nil
	}
	candidates := make([]*model.MediaFile, 0, len(mediaFiles))
	for i := range mediaFiles {
		candidates = append(candidates, &mediaFiles[i])
	}
	cur, err := l.resolveCurrent(ctx, candidates)
	return l.forClients(ctx, cur.list), err
}

func songsByArtistTitleWithLyricsFirst(artist, title string) model.QueryOptions {
	return model.QueryOptions{
		Sort:  "lyrics, updated_at",
		Order: "desc",
		Filters: And{
			Eq{"missing": false},
			Eq{"title": title},
			Or{
				persistence.Exists("json_tree(participants, '$.albumartist')", Eq{"value": artist}),
				persistence.Exists("json_tree(participants, '$.artist')", Eq{"value": artist}),
			},
		},
	}
}

// legacyHit is a result of the configured lyricspriority sources.
type legacyHit struct {
	list  model.LyricList
	token string
	mf    *model.MediaFile
}

// resolveLegacy tries the configured sources in order (lyricspriority): sidecar
// files by suffix, embedded tags and lyrics plugins. This is how Lyvune has
// always picked lyrics, and it is what "local files first" means by default.
func (l *lyricsService) resolveLegacy(ctx context.Context, mediaFiles []*model.MediaFile) (legacyHit, bool) {
	for pattern := range strings.SplitSeq(conf.Server.LyricsPriority, ",") {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" || strings.EqualFold(pattern, EnvelopeSuffix) {
			continue
		}

		for _, mf := range mediaFiles {
			if mf == nil {
				continue
			}

			lyricsList, err := l.getLyricsFromSource(ctx, mf, pattern)
			if err != nil {
				log.Error(ctx, "error getting lyrics", "source", pattern, err)
				continue
			}

			if len(lyricsList) > 0 {
				return legacyHit{list: lyricsList, token: pattern, mf: mf}, true
			}
		}
	}

	return legacyHit{}, false
}

func (l *lyricsService) getLyricsFromSource(ctx context.Context, mf *model.MediaFile, pattern string) (model.LyricList, error) {
	switch {
	case strings.EqualFold(pattern, "embedded"):
		return fromEmbedded(ctx, mf)
	case strings.HasPrefix(pattern, "."):
		return fromExternalFile(ctx, mf, pattern)
	default:
		return l.fromPlugin(ctx, mf, pattern)
	}
}

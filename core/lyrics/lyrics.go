package lyrics

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"time"

	. "github.com/Masterminds/squirrel"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/persistence"
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
	flight    singleflight.Group
	now       func() time.Time

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
}

// NewLyrics creates a new lyrics service. pluginLoader may be nil if no plugin
// system is available.
func NewLyrics(ds model.DataStore, pluginLoader PluginLoader) Lyrics {
	return NewService(Options{DataStore: ds, PluginLoader: pluginLoader})
}

// NewService creates a lyrics service from explicit options.
func NewService(o Options) Lyrics {
	if o.Providers == nil {
		o.Providers = NewProviders(
			NewLRCLIB(conf.Server.Lyrics.LRCLIB.BaseURL, conf.Server.Lyrics.LRCLIB.Enabled),
			NewMusixmatch("", conf.Server.Lyrics.Musixmatch.ApiKey),
			NewKuGou(), NewNetEase(), NewAppleMusic(),
		)
	}
	if o.Store == nil {
		o.Store = NewStore(filepath.Join(conf.Server.DataFolder.String(), "lyrics-history"), conf.Server.Lyrics.HistoryKeep)
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return &lyricsService{
		ds: o.DataStore, pluginLoader: o.PluginLoader,
		props: propertyStore{ds: o.DataStore}, store: o.Store, providers: o.Providers,
		searches: newSearchCache(), now: o.Now, bulkJobs: map[string]*bulkJob{},
	}
}

// GetLyrics returns lyrics for the given media file, trying sources in the
// order specified by conf.Server.LyricsPriority.
func (l *lyricsService) GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	return cur.list, err
}

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
	return cur.list, err
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
// files by suffix, embedded tags and lyrics plugins. This is how Navidrome has
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

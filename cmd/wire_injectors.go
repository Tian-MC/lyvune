//go:build wireinject

package cmd

import (
	"context"

	"github.com/Tian-MC/lyvune/adapters/lastfm"
	"github.com/Tian-MC/lyvune/adapters/listenbrainz"
	"github.com/Tian-MC/lyvune/core"
	"github.com/Tian-MC/lyvune/core/agents"
	"github.com/Tian-MC/lyvune/core/artwork"
	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/core/metrics"
	"github.com/Tian-MC/lyvune/core/playback"
	"github.com/Tian-MC/lyvune/core/playlists"
	"github.com/Tian-MC/lyvune/core/scrobbler"
	"github.com/Tian-MC/lyvune/core/sonic"
	"github.com/Tian-MC/lyvune/db"
	"github.com/Tian-MC/lyvune/model"
	"github.com/Tian-MC/lyvune/persistence"
	"github.com/Tian-MC/lyvune/plugins"
	"github.com/Tian-MC/lyvune/scanner"
	"github.com/Tian-MC/lyvune/server"
	"github.com/Tian-MC/lyvune/server/apiv1"
	"github.com/Tian-MC/lyvune/server/events"
	"github.com/Tian-MC/lyvune/server/jellyfin"
	"github.com/Tian-MC/lyvune/server/nativeapi"
	"github.com/Tian-MC/lyvune/server/public"
	"github.com/Tian-MC/lyvune/server/subsonic"
	"github.com/google/wire"
)

var allProviders = wire.NewSet(
	core.Set,
	artwork.Set,
	server.New,
	subsonic.New,
	jellyfin.New,
	jellyfin.NewDiscovery,
	apiv1.New,
	nativeapi.New,
	public.New,
	persistence.New,
	lastfm.NewRouter,
	listenbrainz.NewRouter,
	events.GetBroker,
	scanner.GetInstance,
	scanner.GetWatcher,
	metrics.GetPrometheusInstance,
	db.Db,
	plugins.GetManager,
	sonic.New,
	wire.Bind(new(agents.PluginLoader), new(*plugins.Manager)),
	wire.Bind(new(scrobbler.PluginLoader), new(*plugins.Manager)),
	wire.Bind(new(lyrics.PluginLoader), new(*plugins.Manager)),
	wire.Bind(new(sonic.PluginLoader), new(*plugins.Manager)),
	wire.Bind(new(sonic.Engine), new(*sonic.Sonic)),
	wire.Bind(new(nativeapi.PluginManager), new(*plugins.Manager)),
	wire.Bind(new(core.PluginUnloader), new(*plugins.Manager)),
	wire.Bind(new(plugins.PluginMetricsRecorder), new(metrics.Metrics)),
	wire.Bind(new(core.Watcher), new(scanner.Watcher)),
	wire.Bind(new(playlists.ImageUploadService), new(artwork.Uploader)),
)

func CreateDataStore() model.DataStore {
	panic(wire.Build(
		allProviders,
	))
}

func CreateServer() *server.Server {
	panic(wire.Build(
		allProviders,
	))
}

func CreateNativeAPIRouter(ctx context.Context) *nativeapi.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateSubsonicAPIRouter(ctx context.Context) *subsonic.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateJellyfinAPIRouter(ctx context.Context) *jellyfin.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateAPIv1Router(ctx context.Context) *apiv1.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreatePublicRouter() *public.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateLastFMRouter() *lastfm.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateListenBrainzRouter() *listenbrainz.Router {
	panic(wire.Build(
		allProviders,
	))
}

func CreateJellyfinDiscovery() *jellyfin.Discovery {
	panic(wire.Build(
		allProviders,
	))
}

func CreateInsights() metrics.Insights {
	panic(wire.Build(
		allProviders,
	))
}

func CreatePrometheus() metrics.Metrics {
	panic(wire.Build(
		allProviders,
	))
}

func CreateScanner(ctx context.Context) model.Scanner {
	panic(wire.Build(
		allProviders,
	))
}

func CreateScanWatcher(ctx context.Context) scanner.Watcher {
	panic(wire.Build(
		allProviders,
	))
}

func GetPlaybackServer() playback.PlaybackServer {
	panic(wire.Build(
		allProviders,
	))
}

func CreateArtworkWorker() *artwork.Worker {
	panic(wire.Build(
		allProviders,
	))
}

func CreateArtworkResolver(trace *artwork.ChainTrace, live bool) *artwork.TracingResolver {
	panic(wire.Build(
		allProviders,
		artwork.NewTracingResolver,
	))
}

func getPluginManager() *plugins.Manager {
	panic(wire.Build(
		allProviders,
	))
}

func GetPluginManager(ctx context.Context) *plugins.Manager {
	manager := getPluginManager()
	manager.SetSubsonicRouter(CreateSubsonicAPIRouter(ctx))
	return manager
}

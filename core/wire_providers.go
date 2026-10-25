package core

import (
	"github.com/Tian-MC/lyvune/core/agents"
	"github.com/Tian-MC/lyvune/core/external"
	"github.com/Tian-MC/lyvune/core/ffmpeg"
	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/core/matcher"
	"github.com/Tian-MC/lyvune/core/metrics"
	"github.com/Tian-MC/lyvune/core/playback"
	"github.com/Tian-MC/lyvune/core/playlists"
	"github.com/Tian-MC/lyvune/core/quickconnect"
	"github.com/Tian-MC/lyvune/core/scrobbler"
	"github.com/Tian-MC/lyvune/core/stream"
	"github.com/google/wire"
)

var Set = wire.NewSet(
	stream.NewMediaStreamer,
	stream.GetTranscodingCache,
	NewArchiver,
	NewPlayers,
	NewShare,
	playlists.NewPlaylists,
	NewLibrary,
	NewUser,
	NewMaintenance,
	stream.NewTranscodeDecider,
	agents.GetAgents,
	external.NewProvider,
	matcher.New,
	wire.Bind(new(external.Agents), new(*agents.Agents)),
	ffmpeg.New,
	scrobbler.GetPlayTracker,
	playback.GetInstance,
	quickconnect.GetInstance,
	metrics.GetInstance,
	lyrics.NewLyrics,
	lyrics.EngineOf,
)

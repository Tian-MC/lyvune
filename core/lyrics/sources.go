package lyrics

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"strings"

	"github.com/Tian-MC/lyvune/core/storage"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
	"github.com/Tian-MC/lyvune/utils/ioutils"
)

func fromEmbedded(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	if mf.Lyrics != "" {
		log.Trace(ctx, "embedded lyrics found in file", "title", mf.Title)
		return mf.StructuredLyrics()
	}

	log.Trace(ctx, "no embedded lyrics for file", "path", mf.Title)

	return nil, nil
}

func fromExternalFile(ctx context.Context, mf *model.MediaFile, suffix string) (model.LyricList, error) {
	ext := path.Ext(mf.Path)
	sidecarRelPath := mf.Path[0:len(mf.Path)-len(ext)] + suffix
	ctx = log.NewContext(ctx, "file", sidecarRelPath)

	store, err := storage.For(mf.LibraryPath)
	if err != nil {
		return nil, fmt.Errorf("getting storage for library: %w", err)
	}
	fsys, err := store.FS()
	if err != nil {
		return nil, fmt.Errorf("opening library filesystem: %w", err)
	}

	f, err := fsys.Open(sidecarRelPath)
	if errors.Is(err, fs.ErrNotExist) {
		log.Trace(ctx, "no lyrics found at path")
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, maxSidecarBytes))
	if err != nil {
		return nil, err
	}

	var list model.LyricList
	if parsed, handled, perr := parseWordTimedSidecar(suffix, raw); handled {
		list, err = parsed, perr
	} else {
		var contents []byte
		contents, err = io.ReadAll(ioutils.UTF8Reader(bytes.NewReader(raw)))
		if err != nil {
			return nil, err
		}
		list, err = model.ParseLyrics(ctx, suffix, "xxx", contents)
	}
	if err != nil {
		log.Error(ctx, "error parsing external lyric file", err)
		return nil, err
	}

	if len(list) == 0 {
		log.Trace(ctx, "empty lyrics from external file")
		return nil, nil
	}

	log.Trace(ctx, "retrieved lyrics from external file")
	return list, nil
}

// fromPlugin attempts to load lyrics from a plugin with the given name.
func (l *lyricsService) fromPlugin(ctx context.Context, mf *model.MediaFile, pluginName string) (model.LyricList, error) {
	if l.pluginLoader == nil {
		log.Debug(ctx, "Invalid lyric source", "source", pluginName)
		return nil, nil
	}

	provider, ok := l.pluginLoader.LoadLyricsProvider(pluginName)
	if !ok {
		log.Warn(ctx, "Lyrics plugin not found", "plugin", pluginName)
		return nil, nil
	}

	lyricsList, err := provider.GetLyrics(ctx, mf)
	if err != nil {
		return nil, err
	}

	if len(lyricsList) > 0 {
		log.Trace(ctx, "Retrieved lyrics from plugin", "plugin", pluginName, "count", len(lyricsList))
	}
	return lyricsList, nil
}

// maxSidecarBytes bounds how much of a sidecar file is read.
const maxSidecarBytes = 16 << 20

// parseWordTimedSidecar reads the word-timed formats Lyvune's own parsers do
// not know: KuGou KRC (plain or as distributed), NetEase YRC and QQ QRC (decrypted). handled is
// false for every other suffix.
func parseWordTimedSidecar(suffix string, raw []byte) (list model.LyricList, handled bool, err error) {
	switch strings.ToLower(suffix) {
	case ".krc":
		text, derr := DecodeKRC(raw)
		if derr != nil {
			return nil, true, derr
		}
		list, err = ParseKRC(text)
		return list, true, err
	case ".qrc":
		text := strings.TrimPrefix(string(raw), "\ufeff")
		list, _, err = ParseQRC(text)
		return list, true, err
	case ".yrc":
		list, err = ParseYRC(strings.TrimPrefix(string(raw), "\ufeff"))
		return list, true, err
	}
	return nil, false, nil
}

package lyrics

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Tian-MC/lyvune/model"
)

// Errors returned by the sidecar store.
var (
	// ErrNotLocal means the library is not on the local filesystem.
	ErrNotLocal = errors.New("lyrics can only be written to a local library")
	// ErrUnsafePath means a path escapes the library or goes through a symlink.
	ErrUnsafePath = errors.New("refusing to write outside the library or through a symlink")
	// ErrReadOnly means the folder cannot be written to.
	ErrReadOnly = errors.New("the library folder is read-only")
	// ErrNotManaged means the file at the target was not written by Lyvune.
	ErrNotManaged = errors.New("the existing file was not written by Lyvune")
	// ErrNoVersion means the requested history entry does not exist.
	ErrNoVersion = errors.New("no such lyrics version")
	// ErrVerifyFailed means the file read back after writing was not what was written.
	ErrVerifyFailed = errors.New("written lyrics could not be verified")
)

// DefaultHistoryKeep is how many previous versions are kept per track.
const DefaultHistoryKeep = 10

// Store writes lyrics sidecars next to the audio files, safely.
//
// It only ever creates, replaces or removes `.lyrics.json` files that carry the
// Lyvune envelope. Files other tools or the user wrote (`.lrc`, `.ttml`, …)
// and the audio itself are never touched. Every change first saves the previous
// content to a bounded history kept outside the library.
type Store struct {
	historyDir string
	keep       int

	mu    sync.Mutex
	locks map[string]*pathLock
}

type pathLock struct {
	mu   sync.Mutex
	refs int
}

// NewStore returns a store that keeps its history under historyDir.
func NewStore(historyDir string, keep int) *Store {
	if keep <= 0 {
		keep = DefaultHistoryKeep
	}
	return &Store{historyDir: historyDir, keep: keep, locks: map[string]*pathLock{}}
}

// Version is one entry of a track's lyrics history.
type Version struct {
	ID       string    `json:"id"`
	At       time.Time `json:"at"`
	Name     string    `json:"name"`
	Existed  bool      `json:"existed"`
	Size     int       `json:"size"`
	Origin   string    `json:"origin,omitempty"`
	Provider string    `json:"provider,omitempty"`
	Quality  string    `json:"quality,omitempty"`
}

// Target identifies a track's sidecar location.
type Target struct {
	// Root is the library path (a plain path or a file:// URL).
	Root string
	// AudioRel is the audio file path relative to Root, using forward slashes.
	AudioRel string
}

func (s *Store) lock(key string) func() {
	s.mu.Lock()
	l, ok := s.locks[key]
	if !ok {
		l = &pathLock{}
		s.locks[key] = l
	}
	l.refs++
	s.mu.Unlock()

	l.mu.Lock()
	return func() {
		l.mu.Unlock()
		s.mu.Lock()
		l.refs--
		if l.refs == 0 {
			delete(s.locks, key)
		}
		s.mu.Unlock()
	}
}

// localRoot returns the OS path of a library, or ErrNotLocal.
func localRoot(root string) (string, error) {
	if !strings.Contains(root, "://") {
		return filepath.Clean(root), nil
	}
	u, err := url.Parse(root)
	if err != nil || u.Scheme != "file" {
		return "", ErrNotLocal
	}
	path := u.Path
	if runtime.GOOS == "windows" {
		path = trimDriveSlash(path)
	}
	return filepath.Clean(filepath.FromSlash(path)), nil
}

// trimDriveSlash turns the path of a Windows file URL (file:///C:/music, whose path is /C:/music) into C:/music.
func trimDriveSlash(p string) string {
	if len(p) >= 3 && p[0] == '/' && p[2] == ':' {
		return p[1:]
	}
	return p
}

// isRooted tells a path that starts at a root, or on a drive, from one that is relative to the library. On Windows
// "/etc/passwd" is not absolute for filepath.IsAbs, and it must be refused all the same.
func isRooted(rel string) bool {
	return filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, string(filepath.Separator))
}

// SidecarName is the file name used for a track's envelope. Tracks that share a
// base name with another audio file (01 - Song.flac and 01 - Song.mp3) get the
// audio extension in the name so the two never collide. Other files with the
// same base name, such as 01 - Song.lrc or a cover image, are not audio and do
// not count.
func SidecarName(audioName string, siblings []string) string {
	ext := filepath.Ext(audioName)
	base := strings.TrimSuffix(audioName, ext)
	for _, other := range siblings {
		if other != audioName && model.IsAudioFile(other) && strings.TrimSuffix(other, filepath.Ext(other)) == base {
			return audioName + EnvelopeSuffix
		}
	}
	return base + EnvelopeSuffix
}

// CandidateNames lists the envelope names to look for, most specific first.
func CandidateNames(audioName string) []string {
	ext := filepath.Ext(audioName)
	return []string{audioName + EnvelopeSuffix, strings.TrimSuffix(audioName, ext) + EnvelopeSuffix}
}

// resolved is a validated location inside the library.
type resolved struct {
	dir  string
	name string
	path string
}

// resolve validates the audio path and returns where the sidecar goes. It
// refuses paths that leave the library, including through symlinked folders.
func (s *Store) resolve(t Target) (resolved, error) {
	root, err := localRoot(t.Root)
	if err != nil {
		return resolved{}, err
	}
	rel := filepath.FromSlash(t.AudioRel)
	if rel == "" || isRooted(rel) || rel != filepath.Clean(rel) || strings.HasPrefix(rel, "..") {
		return resolved{}, fmt.Errorf("%w: %q", ErrUnsafePath, t.AudioRel)
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return resolved{}, fmt.Errorf("library folder: %w", err)
	}
	dir := filepath.Join(realRoot, filepath.Dir(rel))
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return resolved{}, fmt.Errorf("track folder: %w", err)
	}
	if inside, err := filepath.Rel(realRoot, realDir); err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return resolved{}, fmt.Errorf("%w: %q", ErrUnsafePath, t.AudioRel)
	}

	audioName := filepath.Base(rel)
	entries, err := os.ReadDir(realDir)
	if err != nil {
		return resolved{}, fmt.Errorf("track folder: %w", err)
	}
	var siblings []string
	existing := ""
	for _, e := range entries {
		siblings = append(siblings, e.Name())
	}
	for _, candidate := range CandidateNames(audioName) {
		for _, name := range siblings {
			if name == candidate {
				existing = candidate
			}
		}
		if existing != "" {
			break
		}
	}
	name := existing
	if name == "" {
		name = SidecarName(audioName, siblings)
	}
	return resolved{dir: realDir, name: name, path: filepath.Join(realDir, name)}, nil
}

func (s *Store) key(t Target) string {
	sum := sha256.Sum256([]byte(filepath.Clean(t.Root) + "\x00" + t.AudioRel))
	return hex.EncodeToString(sum[:])[:20]
}

// checkTarget refuses a symlink or a non-regular file at the target path.
func checkTarget(path string) (exists bool, err error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return true, fmt.Errorf("%w: %s", ErrUnsafePath, filepath.Base(path))
	}
	return true, nil
}

// Read returns the envelope stored for the track, if there is one.
func (s *Store) Read(t Target) (Envelope, string, error) {
	r, err := s.resolve(t)
	if err != nil {
		return Envelope{}, "", err
	}
	exists, err := checkTarget(r.path)
	if err != nil || !exists {
		if err == nil {
			err = fs.ErrNotExist
		}
		return Envelope{}, r.name, err
	}
	data, err := os.ReadFile(r.path)
	if err != nil {
		return Envelope{}, r.name, err
	}
	env, err := ParseEnvelope(data)
	return env, r.name, err
}

// Save writes env as the track's sidecar. A previous Lyvune sidecar is kept
// in the history first. A file at the target that is not a Lyvune envelope
// is never overwritten.
func (s *Store) Save(t Target, env Envelope) (Version, error) {
	data, err := env.Marshal()
	if err != nil {
		return Version{}, err
	}
	r, err := s.resolve(t)
	if err != nil {
		return Version{}, err
	}
	unlock := s.lock(r.path)
	defer unlock()

	prev, err := s.snapshot(t, r)
	if err != nil {
		return Version{}, err
	}
	if err := atomicWrite(r.path, data); err != nil {
		return Version{}, err
	}
	if err := verify(r.path, data); err != nil {
		return Version{}, err
	}
	s.prune(t)
	return prev, nil
}

// Delete removes the track's Lyvune sidecar, keeping it in the history.
func (s *Store) Delete(t Target) (Version, error) {
	r, err := s.resolve(t)
	if err != nil {
		return Version{}, err
	}
	unlock := s.lock(r.path)
	defer unlock()

	exists, err := checkTarget(r.path)
	if err != nil {
		return Version{}, err
	}
	if !exists {
		return Version{}, fs.ErrNotExist
	}
	prev, err := s.snapshot(t, r)
	if err != nil {
		return Version{}, err
	}
	if err := os.Remove(r.path); err != nil {
		return Version{}, mapWriteErr(err)
	}
	s.prune(t)
	return prev, nil
}

// snapshot saves the current sidecar to the history before it changes. A
// missing file is recorded too, so the first write can be undone. A file that
// is not a Lyvune envelope stops the operation: it belongs to someone else.
func (s *Store) snapshot(t Target, r resolved) (Version, error) {
	exists, err := checkTarget(r.path)
	if err != nil {
		return Version{}, err
	}
	v := Version{ID: fmt.Sprintf("%d", time.Now().UnixNano()), At: time.Now().UTC(), Name: r.name, Existed: exists}
	var data []byte
	if exists {
		if data, err = os.ReadFile(r.path); err != nil {
			return Version{}, err
		}
		env, perr := ParseEnvelope(data)
		if perr != nil {
			return Version{}, fmt.Errorf("%w: %s", ErrNotManaged, r.name)
		}
		v.Origin, v.Provider, v.Quality = env.Origin, env.Provider, env.Quality
		v.Size = len(data)
	}
	dir := filepath.Join(s.historyDir, s.key(t))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Version{}, fmt.Errorf("lyrics history: %w", err)
	}
	meta, _ := json.Marshal(v)
	if exists {
		if err := atomicWriteMode(filepath.Join(dir, v.ID+".data"), data, 0o600); err != nil {
			return Version{}, fmt.Errorf("lyrics history: %w", err)
		}
	}
	if err := atomicWriteMode(filepath.Join(dir, v.ID+".json"), meta, 0o600); err != nil {
		return Version{}, fmt.Errorf("lyrics history: %w", err)
	}
	return v, nil
}

// Versions lists the track's history, newest first.
func (s *Store) Versions(t Target) []Version {
	dir := filepath.Join(s.historyDir, s.key(t))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []Version
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var v Version
		if json.Unmarshal(raw, &v) == nil && v.ID != "" {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

func (s *Store) prune(t Target) {
	versions := s.Versions(t)
	if len(versions) <= s.keep {
		return
	}
	dir := filepath.Join(s.historyDir, s.key(t))
	for _, v := range versions[s.keep:] {
		_ = os.Remove(filepath.Join(dir, v.ID+".json"))
		_ = os.Remove(filepath.Join(dir, v.ID+".data"))
	}
}

// Restore puts a history version back as the track's sidecar. The current
// state is kept in the history first, so a restore can be undone too.
func (s *Store) Restore(t Target, versionID string) (Version, error) {
	var chosen *Version
	for _, v := range s.Versions(t) {
		if v.ID == versionID {
			v := v
			chosen = &v
			break
		}
	}
	if chosen == nil {
		return Version{}, ErrNoVersion
	}
	r, err := s.resolve(t)
	if err != nil {
		return Version{}, err
	}
	unlock := s.lock(r.path)
	defer unlock()

	var data []byte
	if chosen.Existed {
		data, err = os.ReadFile(filepath.Join(s.historyDir, s.key(t), chosen.ID+".data"))
		if err != nil {
			return Version{}, ErrNoVersion
		}
		if _, err := ParseEnvelope(data); err != nil {
			return Version{}, err
		}
	}
	prev, err := s.snapshot(t, r)
	if err != nil {
		return Version{}, err
	}
	if chosen.Existed {
		if err := atomicWrite(r.path, data); err != nil {
			return Version{}, err
		}
		if err := verify(r.path, data); err != nil {
			return Version{}, err
		}
	} else if err := os.Remove(r.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Version{}, mapWriteErr(err)
	}
	s.prune(t)
	return prev, nil
}

func atomicWrite(path string, data []byte) error {
	return atomicWriteMode(path, data, 0o644)
}

// atomicWriteMode writes to a temporary file in the same folder, flushes it and
// renames it over the target, so a crash leaves either the old file or the new
// one, never a partial file. The previous content is not removed first.
func atomicWriteMode(path string, data []byte, mode os.FileMode) (err error) {
	dir, name := filepath.Split(path)
	suffix := make([]byte, 6)
	if _, rerr := rand.Read(suffix); rerr != nil {
		return rerr
	}
	tmp := filepath.Join(dir, "."+name+".tmp-"+hex.EncodeToString(suffix))
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return mapWriteErr(err)
	}
	defer func() {
		if err != nil {
			_ = os.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return mapWriteErr(err)
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return mapWriteErr(err)
	}
	if err = f.Close(); err != nil {
		return mapWriteErr(err)
	}
	if err = os.Rename(tmp, path); err != nil {
		return mapWriteErr(err)
	}
	if d, derr := os.Open(filepath.Clean(dir)); derr == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func verify(path string, want []byte) error {
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(want) {
		return ErrVerifyFailed
	}
	return nil
}

func mapWriteErr(err error) error {
	// EROFS has no portable constant, so match its message
	if errors.Is(err, fs.ErrPermission) || strings.Contains(err.Error(), "read-only file system") {
		return fmt.Errorf("%w: %w", ErrReadOnly, err)
	}
	return err
}

// Update changes the metadata of the track's Lyvune sidecar in place, such as
// the lock or the sync offset. It is atomic like Save but does not add a history
// entry: these are small, trivially reversible settings and must not push real
// lyrics versions out of the bounded history. The lyrics are never touched.
func (s *Store) Update(t Target, change func(*Envelope)) error {
	r, err := s.resolve(t)
	if err != nil {
		return err
	}
	unlock := s.lock(r.path)
	defer unlock()

	exists, err := checkTarget(r.path)
	if err != nil {
		return err
	}
	if !exists {
		return fs.ErrNotExist
	}
	data, err := os.ReadFile(r.path)
	if err != nil {
		return err
	}
	env, err := ParseEnvelope(data)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrNotManaged, r.name)
	}
	lyricsBefore := env.Lyrics
	change(&env)
	env.Lyrics = lyricsBefore
	out, err := env.Marshal()
	if err != nil {
		return err
	}
	if err := atomicWrite(r.path, out); err != nil {
		return err
	}
	return verify(r.path, out)
}

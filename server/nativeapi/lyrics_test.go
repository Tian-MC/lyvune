package nativeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/consts"
	"github.com/navidrome/navidrome/core/auth"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/core/playlists"
	"github.com/navidrome/navidrome/core/storage/local"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/metadata"
	"github.com/navidrome/navidrome/server"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// noopExtractor lets storage.For open local libraries in tests without the real tag reader.
type noopExtractor struct{}

func (noopExtractor) Parse(...string) (map[string]metadata.Info, error) { return nil, nil }
func (noopExtractor) Version() string                                   { return "noop" }

type apiFakeProvider struct{ cands []lyrics.Candidate }

func (f *apiFakeProvider) Info() lyrics.ProviderInfo {
	return lyrics.ProviderInfo{ID: "fake", Name: "Fake", Status: lyrics.StatusReady, Storable: true}
}
func (f *apiFakeProvider) Search(context.Context, lyrics.Recording) ([]lyrics.Candidate, error) {
	return f.cands, nil
}

func int64p(v int64) *int64 { return &v }

func syncedCandidate(id, text string, confidence float64, storable bool) lyrics.Candidate {
	list := model.LyricList{{Kind: model.LyricKindMain, Lang: "eng", Synced: true, Line: []model.Line{{Start: int64p(1000), Value: text}}}}
	return lyrics.Candidate{
		ID: id, Provider: "fake", Source: lyrics.SourceRemote, Lyrics: list, Quality: lyrics.QualitySynced,
		Meta: lyrics.Meta{Title: "Song", Artist: "Band", DurationSec: 200}, Match: lyrics.Match{Confidence: confidence}, Storable: storable,
	}
}

var _ = Describe("Lyrics API", func() {
	var (
		ds           *tests.MockDataStore
		router       http.Handler
		root         string
		admin, user  model.User
		adminTok     string
		userTok      string
		fake         *apiFakeProvider
		audioContent = []byte("AUDIO")
	)

	do := func(method, path, token string, body any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			Expect(json.NewEncoder(&buf).Encode(body)).To(Succeed())
		}
		req := httptest.NewRequest(method, path, &buf)
		req.Header.Set(consts.UIAuthorizationHeader, "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) map[string]any {
		var out map[string]any
		Expect(json.Unmarshal(w.Body.Bytes(), &out)).To(Succeed(), w.Body.String())
		return out
	}

	BeforeEach(func() {
		ctx := GinkgoT().Context()
		DeferCleanup(configtest.SetupConfig())
		local.RegisterExtractor(consts.DefaultScannerExtractor, func(fs.FS, string) local.Extractor { return noopExtractor{} })
		conf.Server.EnableSharing = false
		conf.Server.DevUIShowConfig = true
		conf.Server.LyricsPriority = ".lrc,embedded"

		root = GinkgoT().TempDir()
		Expect(os.MkdirAll(filepath.Join(root, "Artist", "Album"), 0o755)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(root, "Artist", "Album", "01.flac"), audioContent, 0o644)).To(Succeed())

		repo := tests.CreateMockMediaFileRepo()
		repo.SetData(model.MediaFiles{{ID: "song-1", Title: "Song", Artist: "Band", Album: "Album", Duration: 200, Path: "Artist/Album/01.flac", LibraryPath: root}})
		ds = &tests.MockDataStore{MockedMediaFile: repo, MockedProperty: &tests.MockedPropertyRepo{}}
		auth.Init(ds)

		fake = &apiFakeProvider{}
		engine := lyrics.EngineOf(lyrics.NewService(lyrics.Options{
			DataStore: ds, Providers: lyrics.NewProviders(fake), Store: lyrics.NewStore(GinkgoT().TempDir(), 10),
		}))
		_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: []string{"fake"}, PreferLocal: true, AutoRetrieve: true, AutoUpgrade: true})
		Expect(err).ToNot(HaveOccurred())

		router = server.JWTVerifier(New(ds, nil, playlists.NewPlaylists(ds, nil), nil, tests.NewMockLibraryService(), tests.NewMockUserService(), nil, nil, nil, nil, nil, engine))

		admin = model.User{ID: "admin-1", UserName: "admin", Name: "Admin", IsAdmin: true, NewPassword: "pw"}
		user = model.User{ID: "user-1", UserName: "regular", Name: "Regular", NewPassword: "pw"}
		Expect(ds.User().Put(ctx, &admin)).To(Succeed())
		Expect(ds.User().Put(ctx, &user)).To(Succeed())
		adminTok, err = auth.CreateToken(&admin)
		Expect(err).ToNot(HaveOccurred())
		userTok, err = auth.CreateToken(&user)
		Expect(err).ToNot(HaveOccurred())
	})

	AfterEach(func() {
		raw, _ := os.ReadFile(filepath.Join(root, "Artist", "Album", "01.flac"))
		Expect(raw).To(Equal(audioContent), "the audio file is never touched")
	})

	It("requires authentication", func() {
		req := httptest.NewRequest(http.MethodGet, "/lyrics/settings", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		Expect(w.Code).To(Equal(http.StatusUnauthorized))
	})

	Describe("for a regular user", func() {
		It("can read the settings and a track's lyrics state", func() {
			Expect(do("GET", "/lyrics/settings", userTok, nil).Code).To(Equal(http.StatusOK))
			w := do("GET", "/lyrics/song/song-1", userTok, nil)
			Expect(w.Code).To(Equal(http.StatusOK))
			st := decode(w)
			Expect(st).To(HaveKeyWithValue("current", BeNil()))
			Expect(st).To(HaveKey("history"))
			Expect(st["local"]).To(BeEmpty())
		})

		It("can trigger automatic retrieval, which saves lyrics only when verified", func() {
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "fetched", 0.97, true)}
			w := do("POST", "/lyrics/song/song-1/resolve", userTok, nil)
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(decode(w)["result"]).To(Equal("found"))
			Expect(filepath.Join(root, "Artist", "Album", "01.lyrics.json")).To(BeAnExistingFile())
		})

		DescribeTable("cannot change anything in the library",
			func(method, path string, body any) {
				w := do(method, path, userTok, body)
				Expect(w.Code).To(Equal(http.StatusForbidden))
			},
			Entry("settings", "PUT", "/lyrics/settings", map[string]any{}),
			Entry("provider check", "POST", "/lyrics/providers/check", map[string]any{}),
			Entry("search", "POST", "/lyrics/song/song-1/search", map[string]any{}),
			Entry("apply", "POST", "/lyrics/song/song-1/apply", map[string]any{"candidateId": "x"}),
			Entry("import", "POST", "/lyrics/song/song-1/import", map[string]any{"fileName": "a.lrc", "content": "[00:01.00]x"}),
			Entry("lock", "PUT", "/lyrics/song/song-1/lock", map[string]any{"locked": true}),
			Entry("offset", "PUT", "/lyrics/song/song-1/offset", map[string]any{"offsetMs": 100}),
			Entry("restore", "POST", "/lyrics/song/song-1/restore", map[string]any{"version": "1"}),
			Entry("delete", "DELETE", "/lyrics/song/song-1", nil),
			Entry("bulk", "POST", "/lyrics/bulk", map[string]any{"action": "missing", "trackIds": []string{"song-1"}}),
			Entry("bulk status", "GET", "/lyrics/bulk/bulk-1", nil),
			Entry("bulk cancel", "DELETE", "/lyrics/bulk/bulk-1", nil),
		)

		It("leaves the library untouched after all those refusals", func() {
			do("POST", "/lyrics/song/song-1/import", userTok, map[string]any{"fileName": "a.lrc", "content": "[00:01.00]x"})
			entries, _ := os.ReadDir(filepath.Join(root, "Artist", "Album"))
			Expect(entries).To(HaveLen(1))
		})
	})

	Describe("settings", func() {
		It("lists providers with their status and never a credential", func() {
			conf.Server.Lyrics.Musixmatch.ApiKey = "SECRETKEY"
			w := do("GET", "/lyrics/settings", adminTok, nil)
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(w.Body.String()).ToNot(ContainSubstring("SECRETKEY"))
			body := decode(w)
			Expect(body).To(HaveKey("settings"))
			providers := body["providers"].([]any)
			Expect(providers).ToNot(BeEmpty())
			first := providers[0].(map[string]any)
			Expect(first).To(HaveKeyWithValue("id", "fake"))
			Expect(first).To(HaveKeyWithValue("enabled", true))
		})

		It("saves settings and clamps unsafe values", func() {
			w := do("PUT", "/lyrics/settings", adminTok, map[string]any{
				"preferLocal": false, "autoRetrieve": true, "autoUpgrade": false, "autoReplaceManual": true,
				"providers": []string{"fake", "unknown"}, "minConfidence": 0.1,
			})
			Expect(w.Code).To(Equal(http.StatusOK))
			s := decode(w)["settings"].(map[string]any)
			Expect(s).To(HaveKeyWithValue("preferLocal", false))
			Expect(s).To(HaveKeyWithValue("autoReplaceManual", true))
			Expect(s["minConfidence"]).To(BeNumerically("==", lyrics.ConfidenceAuto))
			Expect(s["providers"]).To(ConsistOf("fake"))
		})

		It("rejects a malformed body", func() {
			req := httptest.NewRequest("PUT", "/lyrics/settings", strings.NewReader("{nope"))
			req.Header.Set(consts.UIAuthorizationHeader, "Bearer "+adminTok)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			Expect(w.Code).To(Equal(http.StatusBadRequest))
		})

		It("refreshes the provider status on request, with the runtime fields and no credential", func() {
			conf.Server.Lyrics.QQ.BetterLyricsApiKey = "BLKEY"
			w := do("POST", "/lyrics/providers/check", adminTok, map[string]any{})
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(w.Body.String()).ToNot(ContainSubstring("BLKEY"))
			first := decode(w)["providers"].([]any)[0].(map[string]any)
			Expect(first).To(HaveKeyWithValue("id", "fake"))
			for _, k := range []string{"availability", "liveVerified", "karaokeVerified", "implemented", "configured", "auth"} {
				Expect(first).To(HaveKey(k))
			}
			Expect(first).To(HaveKeyWithValue("liveVerified", true), "the check really asked the provider")
		})

		It("masks the Better Lyrics key in the configuration view", func() {
			conf.Server.Lyrics.QQ.BetterLyricsApiKey = "BLKEY"
			req := httptest.NewRequest("GET", "/config/config", nil)
			req.Header.Set(consts.UIAuthorizationHeader, "Bearer "+adminTok)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(w.Body.String()).ToNot(ContainSubstring("BLKEY"))
		})

		It("masks the Musixmatch API key in the configuration view", func() {
			conf.Server.Lyrics.Musixmatch.ApiKey = "SECRETKEY"
			req := httptest.NewRequest("GET", "/config/config", nil)
			req.Header.Set(consts.UIAuthorizationHeader, "Bearer "+adminTok)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(w.Body.String()).ToNot(ContainSubstring("SECRETKEY"))
		})
	})

	Describe("choosing lyrics as an admin", func() {
		search := func() map[string]any {
			w := do("POST", "/lyrics/song/song-1/search", adminTok, map[string]any{})
			Expect(w.Code).To(Equal(http.StatusOK))
			return decode(w)
		}

		It("lists candidates with a preview, quality, match and storage eligibility", func() {
			fake.cands = []lyrics.Candidate{
				syncedCandidate("fake:1", "first line", 0.97, true),
				syncedCandidate("fake:2", "temporary only", 0.9, false),
			}
			body := search()
			cands := body["candidates"].([]any)
			Expect(cands).To(HaveLen(2))
			c := cands[0].(map[string]any)
			Expect(c).To(HaveKeyWithValue("id", "fake:1"))
			Expect(c).To(HaveKeyWithValue("quality", "synced"))
			Expect(c).To(HaveKeyWithValue("verified", true))
			Expect(c).To(HaveKeyWithValue("storable", true))
			Expect(c["preview"].([]any)[0].(map[string]any)).To(HaveKeyWithValue("text", "first line"))
			Expect(cands[1].(map[string]any)).To(HaveKeyWithValue("storable", false))
			outcomes := body["providers"].([]any)
			Expect(outcomes[0].(map[string]any)).To(HaveKeyWithValue("status", "ok"))
		})

		It("applies a candidate, and tells how to undo it", func() {
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "chosen", 0.97, true)}
			search()
			w := do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:1"})
			Expect(w.Code).To(Equal(http.StatusOK))
			res := decode(w)
			Expect(res["action"]).To(Equal("created-preferred"))
			Expect(res["status"].(map[string]any)["current"].(map[string]any)).To(HaveKeyWithValue("source", "user"))
		})

		It("asks for confirmation before superseding a sidecar", func() {
			Expect(os.WriteFile(filepath.Join(root, "Artist", "Album", "01.lrc"), []byte("[00:01.00]mine"), 0o644)).To(Succeed())
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "chosen", 0.97, true)}
			search()
			w := do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:1"})
			Expect(w.Code).To(Equal(http.StatusConflict))
			Expect(decode(w)).To(HaveKeyWithValue("error", "confirm-required"))

			w = do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:1", "confirm": true})
			Expect(w.Code).To(Equal(http.StatusOK))
			raw, _ := os.ReadFile(filepath.Join(root, "Artist", "Album", "01.lrc"))
			Expect(string(raw)).To(Equal("[00:01.00]mine"))
		})

		It("only accepts a candidate the server found, never lyrics from the client", func() {
			w := do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{
				"candidateId": "fake:evil", "lyrics": "injected", "confirm": true,
			})
			Expect(w.Code).To(Equal(http.StatusNotFound))
			Expect(decode(w)).To(HaveKeyWithValue("error", "no-candidate"))
		})

		It("refuses lyrics that may not be saved", func() {
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "temporary", 0.9, false)}
			search()
			w := do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:1"})
			Expect(w.Code).To(Equal(http.StatusUnprocessableEntity))
			Expect(decode(w)).To(HaveKeyWithValue("error", "not-storable"))
		})

		It("reports locked lyrics and allows a forced replacement", func() {
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "first", 0.97, true)}
			search()
			Expect(do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:1"}).Code).To(Equal(http.StatusOK))
			Expect(do("PUT", "/lyrics/song/song-1/lock", adminTok, map[string]any{"locked": true}).Code).To(Equal(http.StatusOK))

			fake.cands = []lyrics.Candidate{syncedCandidate("fake:2", "second", 0.97, true)}
			search()
			w := do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:2", "confirm": true})
			Expect(w.Code).To(Equal(http.StatusConflict))
			Expect(decode(w)).To(HaveKeyWithValue("error", "locked"))
			w = do("POST", "/lyrics/song/song-1/apply", adminTok, map[string]any{"candidateId": "fake:2", "confirm": true, "force": true})
			Expect(w.Code).To(Equal(http.StatusOK))
		})

		It("imports a file, sets an offset, restores and deletes", func() {
			w := do("POST", "/lyrics/song/song-1/import", adminTok, map[string]any{"fileName": "mine.lrc", "content": "[00:01.00]imported"})
			Expect(w.Code).To(Equal(http.StatusOK))

			w = do("PUT", "/lyrics/song/song-1/offset", adminTok, map[string]any{"offsetMs": 250})
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(decode(w)["offsetMs"]).To(BeNumerically("==", 250))

			w = do("POST", "/lyrics/song/song-1/import", adminTok, map[string]any{"fileName": "other.lrc", "content": "[00:01.00]second", "confirm": true})
			Expect(w.Code).To(Equal(http.StatusOK))
			undo := decode(w)["undo"].(string)
			Expect(undo).ToNot(BeEmpty())

			w = do("POST", "/lyrics/song/song-1/restore", adminTok, map[string]any{"version": undo})
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(decode(w)["status"].(map[string]any)["current"].(map[string]any)["lines"]).To(BeNumerically("==", 1))

			w = do("DELETE", "/lyrics/song/song-1", adminTok, nil)
			Expect(w.Code).To(Equal(http.StatusOK))
			Expect(do("DELETE", "/lyrics/song/song-1", adminTok, nil).Code).To(Equal(http.StatusNotFound))
		})

		It("rejects an empty import and an unknown version", func() {
			Expect(do("POST", "/lyrics/song/song-1/import", adminTok, map[string]any{"fileName": "x.lrc", "content": ""}).Code).To(Equal(http.StatusUnprocessableEntity))
			Expect(do("POST", "/lyrics/song/song-1/restore", adminTok, map[string]any{"version": "nope"}).Code).To(Equal(http.StatusNotFound))
		})

		It("answers 404 for an unknown track", func() {
			Expect(do("GET", "/lyrics/song/nope", adminTok, nil).Code).To(Equal(http.StatusNotFound))
		})
	})

	Describe("bulk jobs", func() {
		It("needs confirmation to replace manual sidecars, and validates the request", func() {
			w := do("POST", "/lyrics/bulk", adminTok, map[string]any{"action": "replace-manual", "trackIds": []string{"song-1"}})
			Expect(w.Code).To(Equal(http.StatusConflict))
			Expect(decode(w)).To(HaveKeyWithValue("error", "confirm-required"))
			Expect(do("POST", "/lyrics/bulk", adminTok, map[string]any{"action": "nuke", "trackIds": []string{"song-1"}}).Code).To(Equal(http.StatusBadRequest))
			Expect(do("GET", "/lyrics/bulk/unknown", adminTok, nil).Code).To(Equal(http.StatusNotFound))
		})

		It("starts a job and reports its progress", func() {
			fake.cands = []lyrics.Candidate{syncedCandidate("fake:1", "fetched", 0.97, true)}
			w := do("POST", "/lyrics/bulk", adminTok, map[string]any{"action": "missing", "trackIds": []string{"song-1"}})
			Expect(w.Code).To(Equal(http.StatusAccepted))
			id := decode(w)["id"].(string)
			Eventually(func() any {
				return decode(do("GET", "/lyrics/bulk/"+id, adminTok, nil))["state"]
			}).Should(Equal("done"))
			Expect(filepath.Join(root, "Artist", "Album", "01.lyrics.json")).To(BeAnExistingFile())
		})
	})
})

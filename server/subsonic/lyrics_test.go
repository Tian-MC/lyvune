package subsonic

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/conf/configtest"
	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	"github.com/Tian-MC/lyvune/server/subsonic/responses"
	"github.com/Tian-MC/lyvune/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("GetLyricsBySongId", func() {
	var router *Router
	var ds model.DataStore
	mockRepo := &mockedMediaFile{MockMediaFileRepo: tests.MockMediaFileRepo{}}

	BeforeEach(func() {
		ds = &tests.MockDataStore{
			MockedMediaFile: mockRepo,
		}
		router = New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, lyrics.NewLyrics(ds, nil), nil, nil)
		DeferCleanup(configtest.SetupConfig())
		conf.Server.LyricsPriority = "embedded,.lrc"
	})

	const syncedLyrics = "[00:18.80]We're no strangers to love\n[00:22.801]You know the rules and so do I"
	const unsyncedLyrics = "We're no strangers to love\nYou know the rules and so do I"
	const metadata = "[ar:Rick Astley]\n[ti:That one song]\n[offset:-100]"
	var times = []int64{18800, 22801}

	compareResponses := func(actual *responses.LyricsList, expected responses.LyricsList) {
		Expect(actual).ToNot(BeNil())
		Expect(actual.StructuredLyrics).To(HaveLen(len(expected.StructuredLyrics)))
		for i, realLyric := range actual.StructuredLyrics {
			expectedLyric := expected.StructuredLyrics[i]

			Expect(realLyric.DisplayArtist).To(Equal(expectedLyric.DisplayArtist))
			Expect(realLyric.DisplayTitle).To(Equal(expectedLyric.DisplayTitle))
			Expect(realLyric.Kind).To(Equal(expectedLyric.Kind))
			Expect(realLyric.Lang).To(Equal(expectedLyric.Lang))
			Expect(realLyric.Synced).To(Equal(expectedLyric.Synced))
			Expect(realLyric.Agents).To(Equal(expectedLyric.Agents))

			if expectedLyric.Offset == nil {
				Expect(realLyric.Offset).To(BeNil())
			} else {
				Expect(*realLyric.Offset).To(Equal(*expectedLyric.Offset))
			}

			Expect(realLyric.Line).To(HaveLen(len(expectedLyric.Line)))
			for j, realLine := range realLyric.Line {
				expectedLine := expectedLyric.Line[j]
				Expect(realLine.Value).To(Equal(expectedLine.Value))

				if expectedLine.Start == nil {
					Expect(realLine.Start).To(BeNil())
				} else {
					Expect(*realLine.Start).To(Equal(*expectedLine.Start))
				}
			}

			Expect(realLyric.CueLine).To(HaveLen(len(expectedLyric.CueLine)))
			for j, realCueLine := range realLyric.CueLine {
				expectedCueLine := expectedLyric.CueLine[j]
				Expect(realCueLine.Index).To(Equal(expectedCueLine.Index))
				Expect(realCueLine.Value).To(Equal(expectedCueLine.Value))
				Expect(realCueLine.AgentID).To(Equal(expectedCueLine.AgentID))
				if expectedCueLine.Start == nil {
					Expect(realCueLine.Start).To(BeNil())
				} else {
					Expect(*realCueLine.Start).To(Equal(*expectedCueLine.Start))
				}
				if expectedCueLine.End == nil {
					Expect(realCueLine.End).To(BeNil())
				} else {
					Expect(*realCueLine.End).To(Equal(*expectedCueLine.End))
				}

				Expect(realCueLine.Cue).To(HaveLen(len(expectedCueLine.Cue)))
				for k, realCue := range realCueLine.Cue {
					expectedCue := expectedCueLine.Cue[k]
					Expect(realCue.Value).To(Equal(expectedCue.Value))
					Expect(realCue.Start).To(Equal(expectedCue.Start))
					Expect(realCue.ByteStart).To(Equal(expectedCue.ByteStart))
					Expect(realCue.ByteEnd).To(Equal(expectedCue.ByteEnd))
					if expectedCue.End == nil {
						Expect(realCue.End).To(BeNil())
					} else {
						Expect(*realCue.End).To(Equal(*expectedCue.End))
					}
				}
			}
		}
	}

	It("should return mixed lyrics", func() {
		r := newGetRequest("id=1")
		syncedList, _ := model.ParseLyrics(GinkgoT().Context(), ".lrc", "eng", []byte(syncedLyrics))
		unsyncedList, _ := model.ParseLyrics(GinkgoT().Context(), ".lrc", "xxx", []byte(unsyncedLyrics))
		synced, _ := syncedList.Main()
		unsynced, _ := unsyncedList.Main()
		lyricsJson, err := json.Marshal(model.LyricList{
			synced, unsynced,
		})
		Expect(err).ToNot(HaveOccurred())

		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJson),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					Lang:          "eng",
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &times[0],
							Value: "We're no strangers to love",
						},
						{
							Start: &times[1],
							Value: "You know the rules and so do I",
						},
					},
				},
				{
					Lang:          "xxx",
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Synced:        false,
					Line: []responses.Line{
						{
							Value: "We're no strangers to love",
						},
						{
							Value: "You know the rules and so do I",
						},
					},
				},
			},
		})
	})

	It("should parse lrc metadata", func() {
		r := newGetRequest("id=1")
		syncedList, _ := model.ParseLyrics(GinkgoT().Context(), ".lrc", "eng", []byte(metadata+"\n"+syncedLyrics))
		synced, _ := syncedList.Main()
		lyricsJson, err := json.Marshal(model.LyricList{
			synced,
		})
		Expect(err).ToNot(HaveOccurred())
		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJson),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())

		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "That one song",
					Lang:          "eng",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &times[0],
							Value: "We're no strangers to love",
						},
						{
							Start: &times[1],
							Value: "You know the rules and so do I",
						},
					},
					Offset: new(int64(-100)),
				},
			},
		})
	})

	It("should return multilingual TTML sidecar lyrics", func() {
		conf.Server.LyricsPriority = ".ttml,embedded"
		r := newGetRequest("id=1")

		fixturesDir, err := filepath.Abs("tests/fixtures")
		Expect(err).ToNot(HaveOccurred())
		mockRepo.SetData(model.MediaFiles{
			{
				ID:          "1",
				LibraryPath: fixturesDir,
				Path:        "test.mp3",
				Artist:      "Rick Astley",
				Title:       "Never Gonna Give You Up",
				Lyrics:      "[]",
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())

		porTime := int64(18800)
		ttmlTime := int64(22800)
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Lang:          "eng",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &times[0],
							Value: "We're no strangers to love",
						},
						{
							Start: &ttmlTime,
							Value: "You know the rules and so do I",
						},
					},
				},
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Lang:          "por",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &porTime,
							Value: "Nao somos estranhos ao amor",
						},
					},
				},
			},
		})
	})

	Describe("translation tracks", func() {
		var kinds func(*responses.LyricsList) []string
		setTTMLFixture := func() {
			conf.Server.LyricsPriority = ".ttml,embedded"
			fixturesDir, err := filepath.Abs("tests/fixtures")
			Expect(err).ToNot(HaveOccurred())
			mockRepo.SetData(model.MediaFiles{{
				ID: "1", LibraryPath: fixturesDir, Path: "test-metadata.mp3",
				Artist: "Rick Astley", Title: "Never Gonna Give You Up", Lyrics: "[]",
			}})
		}
		BeforeEach(func() {
			kinds = func(l *responses.LyricsList) []string {
				var out []string
				for _, s := range l.StructuredLyrics {
					out = append(out, s.Kind)
				}
				return out
			}
		})

		It("leaves translations out of an enhanced response by default, keeping main and pronunciation", func() {
			setTTMLFixture()
			response, err := router.GetLyricsBySongId(newGetRequest("id=1&enhanced=true"))
			Expect(err).ToNot(HaveOccurred())
			Expect(kinds(response.LyricsList)).To(Equal([]string{"main", "pronunciation"}))
			Expect(response.LyricsList.StructuredLyrics[0].Line).To(HaveLen(2), "the original lines are kept")
		})

		It("leaves translations out of the plain response too", func() {
			setTTMLFixture()
			response, err := router.GetLyricsBySongId(newGetRequest("id=1"))
			Expect(err).ToNot(HaveOccurred())
			Expect(response.LyricsList.StructuredLyrics).To(HaveLen(1))
		})

		It("sends them when the administrator turns that on", func() {
			setTTMLFixture()
			Expect(ds.Property().Put(context.Background(), "Lyrics.Settings", `{"exposeTranslationsToClients":true}`)).To(Succeed())
			router = New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, lyrics.NewLyrics(ds, nil), nil, nil)
			response, err := router.GetLyricsBySongId(newGetRequest("id=1&enhanced=true"))
			Expect(err).ToNot(HaveOccurred())
			Expect(kinds(response.LyricsList)).To(ContainElement("translation"))
		})
	})

	Describe("HTML character references in a saved KuGou sidecar", func() {
		var libDir string
		BeforeEach(func() {
			libDir = GinkgoT().TempDir()
			Expect(os.MkdirAll(filepath.Join(libDir, "a"), 0o755)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(libDir, "a", "song.mp3"), []byte("x"), 0o600)).To(Succeed())
			start := func(ms int64) *int64 { return &ms }
			line := model.Line{Start: start(1000), End: start(4000), Value: "senza eta&apos; caf\u00e9 poem&apos;s end", Cue: []model.Cue{
				{Start: start(1000), End: start(1500), Value: "senza ", ByteStart: 0, ByteEnd: 5},
				{Start: start(1500), End: start(2000), Value: "eta&apos; ", ByteStart: 6, ByteEnd: 15},
				{Start: start(2000), End: start(2500), Value: "caf\u00e9 ", ByteStart: 16, ByteEnd: 21},
				{Start: start(2500), End: start(3000), Value: "poem&apos;s ", ByteStart: 22, ByteEnd: 33},
				{Start: start(3000), End: start(4000), Value: "end", ByteStart: 34, ByteEnd: 36},
			}}
			list := model.LyricList{
				{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: []model.Line{line}},
				{Kind: model.LyricKindPronunciation, Lang: "xxx", Synced: true, Line: []model.Line{{Start: start(1000), Value: "e&apos;ta"}}},
				{Kind: model.LyricKindTranslation, Lang: "xxx", Synced: true, Line: []model.Line{{Start: start(1000), Value: "l&apos;et\u00e0"}}},
			}
			env := lyrics.NewEnvelope(lyrics.Candidate{ID: "kugou:H1", Provider: "kugou", Lyrics: list}, lyrics.OriginManaged, time.Now())
			env.TextDecoded = false // as an earlier version wrote it
			_, err := lyrics.NewStore(GinkgoT().TempDir(), 5).Save(lyrics.Target{Root: libDir, AudioRel: "a/song.mp3"}, env)
			Expect(err).ToNot(HaveOccurred())
			mockRepo.SetData(model.MediaFiles{{ID: "1", Artist: "Rhapsody", Title: "Tears of a Dying Angel", LibraryPath: libDir, Path: "a/song.mp3", Lyrics: "[]"}})
		})
		sidecar := func() []byte {
			raw, err := os.ReadFile(filepath.Join(libDir, "a", "song.lyrics.json"))
			Expect(err).ToNot(HaveOccurred())
			return raw
		}

		It("sends the characters, with valid cue offsets, in the enhanced response, and keeps leaving translations out", func() {
			before := sidecar()
			response, err := router.GetLyricsBySongId(newGetRequest("id=1&enhanced=true"))
			Expect(err).ToNot(HaveOccurred())
			Expect(sidecar()).To(Equal(before), "the file is not rewritten")

			got := response.LyricsList.StructuredLyrics
			Expect(got).To(HaveLen(2))
			Expect(got[0].Kind).To(Equal("main"))
			Expect(got[1].Kind).To(Equal("pronunciation"))
			Expect(got[0].Line[0].Value).To(Equal("senza eta' caf\u00e9 poem's end"))
			Expect(got[1].Line[0].Value).To(Equal("e'ta"))
			Expect(got[0].CueLine).To(HaveLen(1))
			cl := got[0].CueLine[0]
			Expect(cl.Value).To(Equal("senza eta' caf\u00e9 poem's end"))
			Expect(cl.Cue).To(HaveLen(5))
			for _, c := range cl.Cue {
				Expect(cl.Value[c.ByteStart : c.ByteEnd+1]).To(Equal(c.Value))
			}
			Expect(cl.Cue[1].Value).To(Equal("eta' "))
			Expect(cl.Cue[3].Value).To(Equal("poem's "))
			Expect(cl.Cue[3].Start).To(Equal(int64(2500)))
			Expect(*cl.Cue[3].End).To(Equal(int64(3000)))
		})

		It("sends the characters in the plain response and in the legacy getLyrics", func() {
			response, err := router.GetLyricsBySongId(newGetRequest("id=1"))
			Expect(err).ToNot(HaveOccurred())
			Expect(response.LyricsList.StructuredLyrics).To(HaveLen(1))
			Expect(response.LyricsList.StructuredLyrics[0].Line[0].Value).To(Equal("senza eta' caf\u00e9 poem's end"))

			legacy, err := router.GetLyrics(newGetRequest("artist=Rhapsody", "title=Tears+of+a+Dying+Angel"))
			Expect(err).ToNot(HaveOccurred())
			Expect(legacy.Lyrics.Value).To(Equal("senza eta' caf\u00e9 poem's end\n"))
		})

		It("sends the same text as before once the administrator wants translations, decoded as well", func() {
			Expect(ds.Property().Put(context.Background(), "Lyrics.Settings", `{"exposeTranslationsToClients":true}`)).To(Succeed())
			router = New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, lyrics.NewLyrics(ds, nil), nil, nil)
			response, err := router.GetLyricsBySongId(newGetRequest("id=1&enhanced=true"))
			Expect(err).ToNot(HaveOccurred())
			got := response.LyricsList.StructuredLyrics
			Expect(got).To(HaveLen(3))
			Expect(got[2].Kind).To(Equal("translation"))
			Expect(got[2].Line[0].Value).To(Equal("l'et\u00e0"))
		})
	})

	It("should return metadata-linked translation and pronunciation tracks from TTML", func() {
		conf.Server.LyricsPriority = ".ttml,embedded"
		Expect(ds.Property().Put(context.Background(), "Lyrics.Settings", `{"exposeTranslationsToClients":true}`)).To(Succeed())
		router = New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, lyrics.NewLyrics(ds, nil), nil, nil)
		r := newGetRequest("id=1&enhanced=true")

		fixturesDir, err := filepath.Abs("tests/fixtures")
		Expect(err).ToNot(HaveOccurred())
		mockRepo.SetData(model.MediaFiles{
			{
				ID:          "1",
				LibraryPath: fixturesDir,
				Path:        "test-metadata.mp3",
				Artist:      "Rick Astley",
				Title:       "Never Gonna Give You Up",
				Lyrics:      "[]",
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())

		mainStartA := int64(1000)
		mainStartB := int64(2000)
		tokenStartA := int64(2000)
		tokenEndA := int64(2300)
		tokenStartB := int64(2300)
		tokenEndB := int64(2600)
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "main",
					Lang:          "ja",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &mainStartA,
							Value: "こんにちは",
						},
						{
							Start: &mainStartB,
							Value: "こんばんは",
						},
					},
				},
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "translation",
					Lang:          "es",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &mainStartA,
							Value: "Hola",
						},
					},
				},
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "pronunciation",
					Lang:          "ja-latn",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &mainStartB,
							Value: "konni",
						},
					},
					CueLine: []responses.CueLine{
						{
							Index: 0,
							Start: &mainStartB,
							End:   &tokenEndB,
							Value: "konni",
							Cue: []responses.LyricCue{
								{
									Start:     tokenStartA,
									End:       &tokenEndA,
									ByteStart: 0,
									ByteEnd:   1,
									Value:     "ko",
								},
								{
									Start:     tokenStartB,
									End:       &tokenEndB,
									ByteStart: 2,
									ByteEnd:   4,
									Value:     "nni",
								},
							},
						},
					},
				},
			},
		})
	})

	It("should return cue lines for songLyrics v2 clients with enhanced=true", func() {
		r := newGetRequest("id=1&enhanced=true")

		lineStart := int64(1000)
		lineEnd := int64(3000)
		tokenStartA := int64(1000)
		tokenEndA := int64(1400)
		tokenStartB := int64(2000)
		tokenEndB := int64(2500)
		lyricsJson, err := json.Marshal(model.LyricList{
			{
				Lang:   "eng",
				Agents: []model.Agent{{ID: "lead", Role: "main"}, {ID: "__nd_bg__|lead", Role: "bg"}},
				Synced: true,
				Line: []model.Line{
					{
						Start: &lineStart,
						End:   &lineEnd,
						Value: "Hello echo",
						Cue: []model.Cue{
							{
								Start:     &tokenStartA,
								End:       &tokenEndA,
								Value:     "Hello",
								ByteStart: 0,
								ByteEnd:   4,
								AgentID:   "lead",
							},
							{
								Start:     &tokenStartB,
								End:       &tokenEndB,
								Value:     "echo",
								ByteStart: 6,
								ByteEnd:   9,
								AgentID:   "__nd_bg__|lead",
							},
						},
					},
				},
			},
		})
		Expect(err).ToNot(HaveOccurred())

		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJson),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "main",
					Lang:          "eng",
					Synced:        true,
					Agents: []responses.Agent{
						{ID: "lead", Role: "main"},
						{ID: "__nd_bg__|lead", Role: "bg"},
					},
					Line: []responses.Line{
						{
							Start: &lineStart,
							Value: "Hello echo",
						},
					},
					CueLine: []responses.CueLine{
						{
							Index:   0,
							Start:   &lineStart,
							End:     &lineEnd,
							Value:   "Hello",
							AgentID: "lead",
							Cue: []responses.LyricCue{
								{
									Start:     tokenStartA,
									End:       &tokenEndA,
									ByteStart: 0,
									ByteEnd:   4,
									Value:     "Hello",
								},
							},
						},
						{
							Index:   0,
							Start:   &lineStart,
							End:     &lineEnd,
							Value:   "echo",
							AgentID: "__nd_bg__|lead",
							Cue: []responses.LyricCue{
								{
									Start:     tokenStartB,
									End:       &tokenEndB,
									ByteStart: 0,
									ByteEnd:   3,
									Value:     "echo",
								},
							},
						},
					},
				},
			},
		})
	})

	It("should preserve shared edge text when remapping agent cue lines", func() {
		lineStart := int64(1000)
		lineEnd := int64(2000)
		cueStart := int64(1200)
		cueEnd := int64(1800)

		cueLines := buildCueLines(model.Line{
			Start: &lineStart,
			End:   &lineEnd,
			Value: "(Hello)",
			Cue: []model.Cue{
				{
					Start:     &cueStart,
					End:       &cueEnd,
					Value:     "Hello",
					ByteStart: 1,
					ByteEnd:   5,
					AgentID:   "lead",
				},
				{
					Start:     &cueStart,
					End:       &cueEnd,
					Value:     "Hello",
					ByteStart: 1,
					ByteEnd:   5,
					AgentID:   "__nd_bg__|lead",
				},
			},
		}, 0, newLyricAgents([]model.Agent{
			{ID: "lead", Role: "main"},
			{ID: "__nd_bg__|lead", Role: "bg"},
		}))

		Expect(cueLines).To(Equal([]responses.CueLine{
			{
				Index:   0,
				Start:   &lineStart,
				End:     &lineEnd,
				Value:   "(Hello)",
				AgentID: "lead",
				Cue: []responses.LyricCue{
					{
						Start:     cueStart,
						End:       &cueEnd,
						Value:     "Hello",
						ByteStart: 1,
						ByteEnd:   5,
					},
				},
			},
			{
				Index:   0,
				Start:   &lineStart,
				End:     &lineEnd,
				Value:   "(Hello)",
				AgentID: "__nd_bg__|lead",
				Cue: []responses.LyricCue{
					{
						Start:     cueStart,
						End:       &cueEnd,
						Value:     "Hello",
						ByteStart: 1,
						ByteEnd:   5,
					},
				},
			},
		}))
	})

	It("should remap cue offsets for interleaved agent cue lines", func() {
		r := newGetRequest("id=1&enhanced=true")

		lineStart := int64(82889)
		lineEnd := int64(86859)
		realStart := int64(85593)
		realEnd := int64(85934)
		slowStart := int64(85934)
		slowEnd := int64(86751)
		bgStartA := int64(83881)
		bgEndA := int64(84243)
		bgStartB := int64(86232)
		bgEndB := int64(86859)
		lyricsJSON, err := json.Marshal(model.LyricList{
			{
				Lang:   "eng",
				Agents: []model.Agent{{ID: "v2", Role: "main"}, {ID: "__nd_bg__|v2", Role: "bg"}},
				Synced: true,
				Line: []model.Line{
					{
						Start: &lineStart,
						End:   &lineEnd,
						Value: "real slow (When you slide)",
						Cue: []model.Cue{
							{
								Start:     &realStart,
								End:       &realEnd,
								Value:     "real",
								ByteStart: 0,
								ByteEnd:   3,
								AgentID:   "v2",
							},
							{
								Start:     &slowStart,
								End:       &slowEnd,
								Value:     "slow",
								ByteStart: 5,
								ByteEnd:   8,
								AgentID:   "v2",
							},
							{
								Start:     &bgStartA,
								End:       &bgEndA,
								Value:     "(When you",
								ByteStart: 10,
								ByteEnd:   18,
								AgentID:   "__nd_bg__|v2",
							},
							{
								Start:     &bgStartB,
								End:       &bgEndB,
								Value:     "slide)",
								ByteStart: 20,
								ByteEnd:   25,
								AgentID:   "__nd_bg__|v2",
							},
						},
					},
				},
			},
		})
		Expect(err).ToNot(HaveOccurred())

		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJSON),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "main",
					Lang:          "eng",
					Synced:        true,
					Agents: []responses.Agent{
						{ID: "v2", Role: "main"},
						{ID: "__nd_bg__|v2", Role: "bg"},
					},
					Line: []responses.Line{
						{
							Start: &lineStart,
							Value: "real slow (When you slide)",
						},
					},
					CueLine: []responses.CueLine{
						{
							Index:   0,
							Start:   &lineStart,
							End:     &lineEnd,
							Value:   "real slow",
							AgentID: "v2",
							Cue: []responses.LyricCue{
								{
									Start:     realStart,
									End:       &realEnd,
									ByteStart: 0,
									ByteEnd:   3,
									Value:     "real",
								},
								{
									Start:     slowStart,
									End:       &slowEnd,
									ByteStart: 5,
									ByteEnd:   8,
									Value:     "slow",
								},
							},
						},
						{
							Index:   0,
							Start:   &lineStart,
							End:     &lineEnd,
							Value:   "(When you slide)",
							AgentID: "__nd_bg__|v2",
							Cue: []responses.LyricCue{
								{
									Start:     bgStartA,
									End:       &bgEndA,
									ByteStart: 0,
									ByteEnd:   8,
									Value:     "(When you",
								},
								{
									Start:     bgStartB,
									End:       &bgEndB,
									ByteStart: 10,
									ByteEnd:   15,
									Value:     "slide)",
								},
							},
						},
					},
				},
			},
		})
	})

	It("should keep enhanced line-level lyrics when no cue data is available", func() {
		r := newGetRequest("id=1&enhanced=true")

		lineStart := int64(1000)
		lineEnd := int64(3000)
		lyricsJSON, err := json.Marshal(model.LyricList{
			{
				Kind:   "main",
				Lang:   "eng",
				Synced: true,
				Line: []model.Line{
					{
						Start: &lineStart,
						End:   &lineEnd,
						Value: "Line without word timing",
					},
				},
			},
		})
		Expect(err).ToNot(HaveOccurred())

		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJSON),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "main",
					Lang:          "eng",
					Synced:        true,
					Line: []responses.Line{
						{
							Start: &lineStart,
							Value: "Line without word timing",
						},
					},
				},
			},
		})
	})

	It("should return required cue byte offsets for ambiguous and multibyte cue lines", func() {
		r := newGetRequest("id=1&enhanced=true")

		asciiLineStart := int64(0)
		asciiLineEnd := int64(2400)
		asciiCueStartA := int64(0)
		asciiCueEndA := int64(300)
		asciiCueStartB := int64(900)
		asciiCueEndB := int64(1300)
		asciiCueStartC := int64(1300)
		asciiCueEndC := int64(1600)
		asciiCueStartD := int64(1600)

		utfLineStart := int64(2747)
		utfLineEnd := int64(6214)
		utfCueStartA := int64(2747)
		utfCueEndA := int64(3018)
		utfCueStartB := int64(3018)
		utfCueEndB := int64(3179)
		utfCueStartC := int64(3582)
		utfCueEndC := int64(4100)
		utfCueStartD := int64(4500)
		utfCueEndD := int64(6214)

		lyricsJSON, err := json.Marshal(model.LyricList{
			{
				Lang:   "eng",
				Synced: true,
				Line: []model.Line{
					{
						Start: &asciiLineStart,
						End:   &asciiLineEnd,
						Value: "Oh love love me tonight",
						Cue: []model.Cue{
							{Start: &asciiCueStartA, End: &asciiCueEndA, Value: "Oh", ByteStart: 0, ByteEnd: 1},
							{Start: &asciiCueStartB, End: &asciiCueEndB, Value: "love", ByteStart: 8, ByteEnd: 11},
							{Start: &asciiCueStartC, End: &asciiCueEndC, Value: "me", ByteStart: 13, ByteEnd: 14},
							{Start: &asciiCueStartD, Value: "tonight", ByteStart: 16, ByteEnd: 22},
						},
					},
					{
						Start: &utfLineStart,
						End:   &utfLineEnd,
						Value: "눈을 뜬 순간",
						Cue: []model.Cue{
							{Start: &utfCueStartA, End: &utfCueEndA, Value: "눈", ByteStart: 0, ByteEnd: 2},
							{Start: &utfCueStartB, End: &utfCueEndB, Value: "을", ByteStart: 3, ByteEnd: 5},
							{Start: &utfCueStartC, End: &utfCueEndC, Value: "뜬", ByteStart: 7, ByteEnd: 9},
							{Start: &utfCueStartD, End: &utfCueEndD, Value: "순간", ByteStart: 11, ByteEnd: 16},
						},
					},
				},
			},
		})
		Expect(err).ToNot(HaveOccurred())

		mockRepo.SetData(model.MediaFiles{
			{
				ID:     "1",
				Artist: "Rick Astley",
				Title:  "Never Gonna Give You Up",
				Lyrics: string(lyricsJSON),
			},
		})

		response, err := router.GetLyricsBySongId(r)
		Expect(err).ToNot(HaveOccurred())
		compareResponses(response.LyricsList, responses.LyricsList{
			StructuredLyrics: responses.StructuredLyrics{
				{
					DisplayArtist: "Rick Astley",
					DisplayTitle:  "Never Gonna Give You Up",
					Kind:          "main",
					Lang:          "eng",
					Synced:        true,
					Line: []responses.Line{
						{Start: &asciiLineStart, Value: "Oh love love me tonight"},
						{Start: &utfLineStart, Value: "눈을 뜬 순간"},
					},
					CueLine: []responses.CueLine{
						{
							Index: 0,
							Start: &asciiLineStart,
							End:   &asciiLineEnd,
							Value: "Oh love love me tonight",
							Cue: []responses.LyricCue{
								{Start: asciiCueStartA, End: &asciiCueEndA, Value: "Oh", ByteStart: 0, ByteEnd: 1},
								{Start: asciiCueStartB, End: &asciiCueEndB, Value: "love", ByteStart: 8, ByteEnd: 11},
								{Start: asciiCueStartC, End: &asciiCueEndC, Value: "me", ByteStart: 13, ByteEnd: 14},
								{Start: asciiCueStartD, End: &asciiLineEnd, Value: "tonight", ByteStart: 16, ByteEnd: 22},
							},
						},
						{
							Index: 1,
							Start: &utfLineStart,
							End:   &utfLineEnd,
							Value: "눈을 뜬 순간",
							Cue: []responses.LyricCue{
								{Start: utfCueStartA, End: &utfCueEndA, Value: "눈", ByteStart: 0, ByteEnd: 2},
								{Start: utfCueStartB, End: &utfCueEndB, Value: "을", ByteStart: 3, ByteEnd: 5},
								{Start: utfCueStartC, End: &utfCueEndC, Value: "뜬", ByteStart: 7, ByteEnd: 9},
								{Start: utfCueStartD, End: &utfCueEndD, Value: "순간", ByteStart: 11, ByteEnd: 16},
							},
						},
					},
				},
			},
		})
	})
})

package conf_test

import (
	"os"
	"path/filepath"

	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/consts"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/spf13/viper"
)

var _ = Describe("telemetry", func() {
	It("is off unless someone turns it on", func() {
		viper.Reset()
		conf.SetViperDefaults()
		Expect(viper.GetBool("enableinsightscollector")).To(BeFalse())
	})
})

// The project was called Navidrome before it was Lyvune: what an existing
// installation has on disk has to keep working.
var _ = Describe("names from before the rename", func() {
	var dir string

	BeforeEach(func() {
		dir = GinkgoT().TempDir()
	})

	Describe("database", func() {
		It("is lyvune.db for a new installation", func() {
			Expect(conf.DefaultDbName(dir)).To(Equal(consts.DefaultDbPath))
			Expect(consts.DefaultDbPath).To(HavePrefix("lyvune.db?"))
		})

		It("keeps navidrome.db when that is the database the server already has", func() {
			Expect(os.WriteFile(filepath.Join(dir, "navidrome.db"), nil, 0600)).To(Succeed())
			Expect(conf.DefaultDbName(dir)).To(Equal(consts.LegacyDbPath))
			Expect(consts.LegacyDbPath).To(HavePrefix("navidrome.db?"))
		})

		It("prefers lyvune.db when both exist", func() {
			Expect(os.WriteFile(filepath.Join(dir, "navidrome.db"), nil, 0600)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(dir, "lyvune.db"), nil, 0600)).To(Succeed())
			Expect(conf.DefaultDbName(dir)).To(Equal(consts.DefaultDbPath))
		})
	})

	Describe("configuration file from ND_CONFIGFILE", func() {
		It("is used when it exists", func() {
			file := filepath.Join(dir, "lyvune.toml")
			Expect(os.WriteFile(file, nil, 0600)).To(Succeed())
			GinkgoT().Setenv("ND_CONFIGFILE", file)
			Expect(conf.GetConfigFile("")).To(Equal(file))
		})

		It("falls back to navidrome.toml beside a lyvune.toml that is not there", func() {
			legacy := filepath.Join(dir, "navidrome.toml")
			Expect(os.WriteFile(legacy, nil, 0600)).To(Succeed())
			GinkgoT().Setenv("ND_CONFIGFILE", filepath.Join(dir, "lyvune.toml"))
			Expect(conf.GetConfigFile("")).To(Equal(legacy))
		})

		It("finds nothing when neither exists", func() {
			GinkgoT().Setenv("ND_CONFIGFILE", filepath.Join(dir, "lyvune.toml"))
			Expect(conf.GetConfigFile("")).To(BeEmpty())
		})

		It("does not look for a navidrome.toml beside any other name", func() {
			Expect(os.WriteFile(filepath.Join(dir, "navidrome.toml"), nil, 0600)).To(Succeed())
			GinkgoT().Setenv("ND_CONFIGFILE", filepath.Join(dir, "other.toml"))
			Expect(conf.GetConfigFile("")).To(BeEmpty())
		})
	})

	Describe("configuration file found in the working directory", func() {
		var wd string

		BeforeEach(func() {
			var err error
			wd, err = os.Getwd()
			Expect(err).ToNot(HaveOccurred())
			Expect(os.Chdir(dir)).To(Succeed())
			DeferCleanup(func() {
				Expect(os.Chdir(wd)).To(Succeed())
				viper.Reset()
			})
			viper.Reset()
		})

		It("is lyvune.toml", func() {
			Expect(os.WriteFile("lyvune.toml", []byte("Port = 1\n"), 0600)).To(Succeed())
			conf.InitConfig("", false)
			Expect(filepath.Base(viper.ConfigFileUsed())).To(Equal("lyvune.toml"))
		})

		It("is navidrome.toml when there is no lyvune.toml", func() {
			Expect(os.WriteFile("navidrome.toml", []byte("Port = 2\n"), 0600)).To(Succeed())
			conf.InitConfig("", false)
			Expect(filepath.Base(viper.ConfigFileUsed())).To(Equal("navidrome.toml"))
			Expect(viper.GetInt("port")).To(Equal(2))
		})

		It("is lyvune.toml when both exist", func() {
			Expect(os.WriteFile("lyvune.toml", []byte("Port = 1\n"), 0600)).To(Succeed())
			Expect(os.WriteFile("navidrome.toml", []byte("Port = 2\n"), 0600)).To(Succeed())
			conf.InitConfig("", false)
			Expect(viper.GetInt("port")).To(Equal(1))
		})
	})
})

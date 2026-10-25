package criteria

import (
	"testing"

	"github.com/Tian-MC/lyvune/log"
	_ "github.com/mattn/go-sqlite3"
	. "github.com/onsi/ginkgo/v2"
	"github.com/onsi/gomega"
)

func TestCriteria(t *testing.T) {
	log.SetLevel(log.LevelFatal)
	gomega.RegisterFailHandler(Fail)
	// Register `genre` as a tag name, so we can use it in tests
	RunSpecs(t, "Criteria Suite")
}

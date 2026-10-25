package lyrics

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("word-timed sidecars", func() {
	// SYNTHETIC KRC text, not provider data
	const krc = "[ar:A]\n[1000,1000]<0,400,0>he<400,600,0>llo"

	It("reads a plain-text .krc file and a .yrc file as karaoke", func() {
		list, handled, err := parseWordTimedSidecar(".KRC", []byte("\xef\xbb\xbf"+krc))
		Expect(handled).To(BeTrue())
		Expect(err).ToNot(HaveOccurred())
		Expect(QualityOf(list)).To(Equal(QualityKaraoke))

		list, handled, err = parseWordTimedSidecar(".yrc", []byte("[1000,1000](1000,400,0)he(1400,600,0)llo"))
		Expect(handled).To(BeTrue())
		Expect(err).ToNot(HaveOccurred())
		Expect(QualityOf(list)).To(Equal(QualityKaraoke))
	})

	It("reports a damaged .krc instead of treating it as plain text", func() {
		_, handled, err := parseWordTimedSidecar(".krc", []byte{0xff, 0x00, 0x81})
		Expect(handled).To(BeTrue())
		Expect(err).To(HaveOccurred())
	})

	It("leaves every other suffix to the regular parsers", func() {
		_, handled, _ := parseWordTimedSidecar(".lrc", []byte("[00:01.00]x"))
		Expect(handled).To(BeFalse())
	})
})

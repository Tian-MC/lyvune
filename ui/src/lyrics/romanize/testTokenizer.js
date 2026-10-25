// The real kuromoji and its real dictionary, loaded from node_modules, for
// tests that check readings and not just that something comes out.
import kuromoji from 'kuromoji'

let built = null

export const realTokenizer = () => {
  if (!built) {
    built = new Promise((resolve, reject) =>
      kuromoji
        .builder({ dicPath: 'node_modules/kuromoji/dict' })
        .build((err, t) => (err ? reject(err) : resolve(t))),
    )
  }
  return built
}

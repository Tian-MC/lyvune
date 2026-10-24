import React from 'react'
import { FormWithRedirect } from 'react-admin'
import { useT } from '../i18n/useT'
import { PageHeader } from '../design/Section'
import { SelectLanguage } from './SelectLanguage'
import { SelectDateFormat } from './SelectDateFormat'
import { SelectTheme } from './SelectTheme'
import { SelectDefaultView } from './SelectDefaultView'
import { NotificationsToggle } from './NotificationsToggle'
import { LastfmScrobbleToggle } from './LastfmScrobbleToggle'
import { ListenBrainzScrobbleToggle } from './ListenBrainzScrobbleToggle'
import { ReplayGainToggle } from './ReplayGainToggle'
import config from '../config'
import styles from './Personal.module.css'

const Group = ({ title, description, children }) => (
  <section className={styles.group}>
    <header className={styles.groupHeader}>
      <h2 className={styles.groupTitle}>{title}</h2>
      {description && <p className={styles.groupText}>{description}</p>}
    </header>
    <div className={styles.fields}>{children}</div>
  </section>
)

const input = { variant: 'outlined', fullWidth: true }

/** Personal settings: every preference of the previous page, grouped. */
const Personal = () => {
  const t = useT()
  const scrobbling = config.lastFMEnabled || config.listenBrainzEnabled
  return (
    <div className={styles.root}>
      <PageHeader title={t('menu.personal.name', 'Personal')} />
      <FormWithRedirect
        save={() => {}}
        toolbar={null}
        render={() => (
          <div className={styles.groups}>
            <Group
              title={t('ui.settings.appearance', 'Appearance')}
              description={t(
                'ui.settings.appearanceHint',
                'How Navidrome looks and which page it opens with.',
              )}
            >
              <SelectTheme {...input} />
              <SelectLanguage {...input} />
              <SelectDateFormat {...input} />
              <SelectDefaultView {...input} />
            </Group>
            {config.enableReplayGain && (
              <Group
                title={t('ui.settings.playback', 'Playback')}
                description={t(
                  'ui.settings.playbackHint',
                  'Volume normalisation using the ReplayGain tags of your files.',
                )}
              >
                <ReplayGainToggle variant="outlined" />
              </Group>
            )}
            <Group title={t('ui.settings.notifications', 'Notifications')}>
              <NotificationsToggle />
            </Group>
            {scrobbling && (
              <Group
                title={t('ui.settings.scrobbling', 'Scrobbling')}
                description={t(
                  'ui.settings.scrobblingHint',
                  'Share what you listen to with external services.',
                )}
              >
                {config.lastFMEnabled && <LastfmScrobbleToggle />}
                {config.listenBrainzEnabled && <ListenBrainzScrobbleToggle />}
              </Group>
            )}
          </div>
        )}
      />
    </div>
  )
}

export default Personal

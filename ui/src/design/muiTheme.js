// Material-UI theme generated from the design tokens (design/tokens.css).
// Every Material-UI based surface (admin forms, dialogs, menus, tooltips) goes
// through this theme, so legacy screens share the new visual language.

export const tokens = {
  blue: '#0084ff',
  blueHover: '#2a97ff',
  blueSolid: '#0073de',
  blueText: '#4ba6ff',
  blueSolidHover: '#0a7ce9',
  blueSoft: 'rgba(0, 132, 255, 0.14)',
  blueSoftHover: 'rgba(0, 132, 255, 0.2)',
  blueBorder: 'rgba(0, 132, 255, 0.5)',
  textOnAccent: '#ffffff',
  surface3Hover: '#2a2d34',
  bgApp: '#08090b',
  bgElevated: '#101114',
  surface1: '#121317',
  surface2: '#181a1f',
  surface3: '#202228',
  hover: 'rgba(255, 255, 255, 0.05)',
  active: 'rgba(255, 255, 255, 0.08)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderDefault: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',
  text1: '#f4f5f7',
  text2: 'rgba(235, 238, 245, 0.66)',
  text3: 'rgba(235, 238, 245, 0.50)',
  textDisabled: 'rgba(235, 238, 245, 0.30)',
  danger: '#ff5c5c',
  warning: '#f5b84a',
  success: '#3ccf91',
  font: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', 'Hiragino Sans', 'Noto Sans CJK JP', sans-serif",
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
  shadowPop:
    '0 16px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.10)',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
}

/**
 * `tint` (legacy dark themes) overrides the accent and surface tokens; see
 * design/legacyThemes.js. The official variants never pass one.
 */
export const createNavidromeTheme = ({
  name,
  oled = false,
  tint = null,
  legacy = null,
} = {}) => {
  const t = tint ? { ...tokens, ...tint } : tokens
  const bgApp = oled ? '#000000' : t.bgApp
  const paper = oled ? '#0b0b0d' : t.surface1
  return {
    themeName: name,
    oled,
    tint,
    legacy,
    palette: {
      type: 'dark',
      primary: { main: t.blue, light: t.blueHover, dark: t.blueSolid },
      secondary: { main: t.blue, light: t.blueHover, dark: t.blueSolid },
      error: { main: t.danger },
      warning: { main: t.warning },
      success: { main: t.success },
      background: { default: bgApp, paper },
      text: {
        primary: t.text1,
        secondary: t.text2,
        disabled: t.textDisabled,
      },
      divider: t.borderSubtle,
      action: {
        hover: t.hover,
        selected: t.blueSoft,
        active: t.text2,
        disabled: t.textDisabled,
        disabledBackground: 'rgba(255,255,255,0.06)',
      },
    },
    shape: { borderRadius: t.radiusMd },
    typography: {
      fontFamily: t.font,
      fontSize: 14,
      h1: { fontWeight: 700, letterSpacing: '-0.035em' },
      h2: { fontWeight: 700, letterSpacing: '-0.03em' },
      h3: { fontWeight: 700, letterSpacing: '-0.025em' },
      h4: { fontWeight: 650, letterSpacing: '-0.02em' },
      h5: { fontWeight: 650, letterSpacing: '-0.015em' },
      h6: { fontWeight: 600, letterSpacing: '-0.01em', fontSize: '1.0625rem' },
      subtitle1: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      overline: { letterSpacing: '0.08em', fontWeight: 600 },
    },
    transitions: {
      easing: {
        easeInOut: t.ease,
        easeOut: t.ease,
        easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
        sharp: t.ease,
      },
    },
    props: {
      MuiButtonBase: { disableRipple: true },
      MuiPaper: { elevation: 0 },
      MuiCard: { elevation: 0 },
      MuiTextField: { variant: 'outlined' },
      MuiUseMediaQuery: { noSsr: true },
      MuiPopover: { disableScrollLock: true },
      MuiSwitch: { color: 'primary' },
      MuiCheckbox: { color: 'primary' },
      MuiRadio: { color: 'primary' },
      MuiTooltip: { enterDelay: 400, arrow: false },
    },
    overrides: {
      MuiCssBaseline: {
        '@global': { body: { backgroundColor: bgApp } },
      },
      MuiPaper: {
        root: { backgroundColor: paper, color: t.text1 },
        rounded: { borderRadius: t.radiusLg },
      },
      MuiCard: {
        root: {
          backgroundColor: paper,
          border: `1px solid ${t.borderSubtle}`,
          borderRadius: t.radiusLg,
          overflow: 'visible',
        },
      },
      MuiCardContent: {
        root: { padding: 24, '&:last-child': { paddingBottom: 24 } },
      },
      MuiAppBar: {
        colorSecondary: { backgroundColor: 'transparent', color: t.text1 },
        colorPrimary: { backgroundColor: 'transparent', color: t.text1 },
      },
      MuiToolbar: { root: { minHeight: 0 }, regular: { minHeight: 0 } },
      MuiButton: {
        root: {
          borderRadius: 999,
          padding: '7px 18px',
          transition: `background-color 150ms ${t.ease}, color 150ms ${t.ease}, border-color 150ms ${t.ease}`,
          '&:focus-visible': {
            boxShadow: `0 0 0 2px ${bgApp}, 0 0 0 4px ${t.blue}`,
          },
        },
        text: { padding: '7px 14px', color: t.text1 },
        textPrimary: {
          color: t.blueText,
          '&:hover': { backgroundColor: t.blueSoft },
        },
        contained: {
          backgroundColor: t.surface3,
          color: t.text1,
          boxShadow: 'none',
          '&:hover': { backgroundColor: t.surface3Hover, boxShadow: 'none' },
          '&:active': { boxShadow: 'none' },
        },
        containedPrimary: {
          backgroundColor: t.blueSolid,
          color: t.textOnAccent,
          '&:hover': { backgroundColor: t.blueSolidHover },
        },
        outlined: { borderColor: t.borderStrong, padding: '6px 17px' },
        outlinedPrimary: {
          borderColor: t.blueBorder,
          color: t.blueText,
        },
        sizeSmall: { padding: '4px 12px', fontSize: '0.8125rem' },
        startIcon: { marginRight: 6 },
      },
      MuiIconButton: {
        root: {
          color: t.text2,
          padding: 10,
          transition: `background-color 150ms ${t.ease}, color 150ms ${t.ease}`,
          '&:hover': { color: t.text1, backgroundColor: t.hover },
          '&:focus-visible': { boxShadow: `0 0 0 2px ${t.blue}` },
        },
        colorPrimary: { color: t.blue },
        sizeSmall: { padding: 6 },
      },
      MuiOutlinedInput: {
        root: {
          borderRadius: t.radiusMd,
          backgroundColor: 'rgba(255,255,255,0.03)',
          '&:hover $notchedOutline': { borderColor: t.borderStrong },
          '&$focused $notchedOutline': {
            borderColor: t.blue,
            borderWidth: 1.5,
          },
        },
        notchedOutline: { borderColor: t.borderDefault },
        input: { padding: '13px 14px' },
        inputMarginDense: { paddingTop: 10, paddingBottom: 10 },
      },
      MuiFilledInput: {
        root: {
          borderRadius: t.radiusMd,
          borderTopLeftRadius: t.radiusMd,
          borderTopRightRadius: t.radiusMd,
          backgroundColor: 'rgba(255,255,255,0.05)',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.07)' },
          '&$focused': { backgroundColor: 'rgba(255,255,255,0.07)' },
        },
        underline: {
          '&:before': { borderBottom: 'none' },
          '&:hover:not($disabled):before': { borderBottom: 'none' },
          '&:after': { borderBottomColor: t.blue, left: 10, right: 10 },
        },
      },
      MuiInput: {
        underline: {
          '&:before': { borderBottomColor: t.borderDefault },
          '&:after': { borderBottomColor: t.blue },
        },
      },
      MuiInputLabel: {
        root: { color: t.text2, '&$focused': { color: t.blueText } },
        outlined: { transform: 'translate(14px, 15px) scale(1)' },
      },
      MuiFormLabel: {
        root: { color: t.text2, '&$focused': { color: t.blueText } },
      },
      MuiFormHelperText: { root: { color: t.text3 } },
      MuiSelect: { icon: { color: t.text2 } },
      MuiMenu: {
        paper: {
          backgroundColor: t.surface2,
          borderRadius: t.radiusMd,
          boxShadow: t.shadowPop,
          minWidth: 200,
        },
        list: { padding: 6 },
      },
      MuiPopover: {
        paper: {
          backgroundColor: t.surface2,
          borderRadius: t.radiusMd,
          boxShadow: t.shadowPop,
        },
      },
      MuiMenuItem: {
        root: {
          borderRadius: t.radiusSm,
          fontSize: '0.875rem',
          minHeight: 38,
          paddingTop: 7,
          paddingBottom: 7,
          '&:hover': { backgroundColor: t.hover },
          '&$selected': {
            backgroundColor: t.blueSoft,
            '&:hover': { backgroundColor: t.blueSoftHover },
          },
        },
      },
      MuiListItem: {
        root: {
          '&$selected': {
            backgroundColor: t.blueSoft,
            '&:hover': { backgroundColor: t.blueSoftHover },
          },
        },
        button: { '&:hover': { backgroundColor: t.hover } },
      },
      MuiListItemIcon: { root: { color: t.text2, minWidth: 40 } },
      MuiListSubheader: {
        root: {
          color: t.text3,
          fontSize: '0.6875rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 600,
          lineHeight: '32px',
        },
        sticky: { backgroundColor: 'transparent' },
      },
      MuiDivider: { root: { backgroundColor: t.borderSubtle } },
      MuiDialog: {
        paper: {
          backgroundColor: t.surface1,
          backgroundImage: 'none',
          borderRadius: t.radiusLg,
          boxShadow: t.shadowPop,
        },
      },
      MuiBackdrop: { root: { backgroundColor: 'rgba(0,0,0,0.6)' } },
      MuiDialogTitle: {
        root: {
          padding: '22px 24px 10px',
          '& h2': { fontWeight: 650, letterSpacing: '-0.015em' },
        },
      },
      MuiDialogContent: { root: { padding: '8px 24px' } },
      MuiDialogActions: { root: { padding: '14px 20px 18px', gap: 6 } },
      MuiTooltip: {
        tooltip: {
          backgroundColor: t.surface3,
          color: t.text1,
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 10px',
          borderRadius: t.radiusSm,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        },
      },
      MuiSnackbarContent: {
        root: {
          backgroundColor: t.surface3,
          color: t.text1,
          borderRadius: t.radiusMd,
          boxShadow: t.shadowPop,
        },
      },
      MuiChip: {
        root: {
          backgroundColor: 'rgba(255,255,255,0.07)',
          color: t.text1,
          height: 28,
        },
        outlined: { borderColor: t.borderDefault },
        colorPrimary: { backgroundColor: t.blueSoft, color: t.blueText },
        clickable: {
          '&:hover, &:focus': { backgroundColor: 'rgba(255,255,255,0.12)' },
        },
      },
      MuiTableCell: {
        root: {
          borderBottom: `1px solid ${t.borderSubtle}`,
          padding: '8px 12px',
          whiteSpace: 'nowrap',
        },
        head: {
          color: t.text3,
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          backgroundColor: 'transparent',
          lineHeight: 1.3,
        },
        sizeSmall: { padding: '6px 10px' },
        paddingCheckbox: { width: 44, padding: '0 0 0 8px' },
      },
      MuiTableRow: {
        root: {
          '&$hover:hover': { backgroundColor: t.hover },
          '&$selected, &$selected:hover': { backgroundColor: t.blueSoft },
        },
      },
      MuiTableSortLabel: {
        root: { '&:hover': { color: t.text1 }, '&$active': { color: t.text1 } },
      },
      MuiTablePagination: {
        root: { color: t.text2, borderTop: 'none' },
      },
      MuiSwitch: {
        switchBase: { color: '#c9cbd1' },
        track: { backgroundColor: 'rgba(255,255,255,0.3)', opacity: 1 },
        colorPrimary: {
          '&$checked': { color: '#fff' },
          '&$checked + $track': { backgroundColor: t.blue, opacity: 1 },
        },
      },
      MuiCheckbox: { root: { color: t.text3 } },
      MuiTabs: {
        indicator: { backgroundColor: t.blue, height: 2, borderRadius: 2 },
      },
      MuiTab: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minWidth: 0,
          '@media (min-width: 600px)': { minWidth: 0 },
          padding: '6px 14px',
        },
        textColorInherit: { opacity: 0.6, '&$selected': { opacity: 1 } },
      },
      MuiLinearProgress: {
        colorPrimary: { backgroundColor: 'rgba(255,255,255,0.1)' },
        barColorPrimary: { backgroundColor: t.blue },
      },
      MuiCircularProgress: { colorPrimary: { color: t.blue } },
      MuiExpansionPanel: { root: { backgroundColor: paper } },
      MuiAccordion: {
        root: { backgroundColor: paper, '&:before': { display: 'none' } },
      },
      MuiLink: { root: { color: t.blueText } },
      MuiAvatar: {
        colorDefault: { backgroundColor: t.surface3, color: t.text2 },
      },
      MuiBadge: { colorPrimary: { backgroundColor: t.blue } },
      MuiDrawer: {
        paper: { backgroundColor: t.bgElevated, borderRight: 'none' },
      },

      // react-admin components (admin CRUD screens)
      RaList: {
        main: { paddingTop: 4 },
        content: {
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          // wide data tables scroll horizontally instead of wrapping cells
          overflowX: 'auto',
        },
      },
      RaLink: {
        link: {
          color: 'inherit',
          '&:hover': { color: t.text1, textDecoration: 'underline' },
        },
      },
      RaListToolbar: {
        toolbar: {
          paddingLeft: 0,
          paddingRight: 0,
          backgroundColor: 'transparent',
        },
      },
      RaTopToolbar: {
        root: { backgroundColor: 'transparent', paddingTop: 12 },
      },
      RaDatagrid: {
        headerCell: { backgroundColor: 'transparent' },
        row: { '&:hover': { backgroundColor: t.hover } },
        rowCell: { color: t.text1 },
      },
      RaBulkActionsToolbar: {
        toolbar: {
          backgroundColor: t.surface2,
          color: t.text1,
          borderRadius: t.radiusMd,
          minHeight: 52,
        },
        topToolbar: { backgroundColor: 'transparent' },
      },
      RaToolbar: {
        toolbar: {
          backgroundColor: 'transparent',
          borderTop: `1px solid ${t.borderSubtle}`,
          marginTop: 0,
        },
        desktopToolbar: { marginTop: 0 },
      },
      RaEdit: { card: { overflow: 'visible' }, main: { marginTop: 8 } },
      RaCreate: { card: { overflow: 'visible' }, main: { marginTop: 8 } },
      RaShow: { card: { overflow: 'visible' } },
      RaFilterForm: { form: { alignItems: 'center' } },
      RaSearchInput: { input: { marginTop: 0 } },
      RaPaginationActions: { currentPageButton: { color: t.blueText } },
      RaLinearProgress: { root: { margin: 8, borderRadius: 2 } },
      RaSidebar: { drawerPaper: { backgroundColor: 'transparent' } },
      RaNotification: {},

      // legacy Navidrome component overrides
      NDLogin: {
        main: { backgroundColor: bgApp },
        systemNameLink: { color: t.blue },
        card: {
          minWidth: 320,
          backgroundColor: 'rgba(18,19,23,0.88)',
          backdropFilter: 'blur(18px)',
          border: `1px solid ${t.borderSubtle}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
        welcome: { color: t.text2 },
        button: { boxShadow: 'none' },
      },
    },
    player: { theme: 'dark' },
  }
}

export const NavidromeTheme = createNavidromeTheme({ name: 'Navidrome' })
export const NavidromeOledTheme = createNavidromeTheme({
  name: 'Navidrome Black (OLED)',
  oled: true,
})

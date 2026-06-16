/* ============================================================
   Icons — thin-line nautical set + compass rose.
   All stroke=currentColor. Exposed on window.
   ============================================================ */
const Svg = ({ s = 20, sw = 1.6, children, ...p }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {children}
  </svg>
);

const Icon = ({ name, s = 20, sw = 1.6, ...p }) => {
  const paths = {
    helm: <><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8.2"/><path d="M12 3.8v3M12 17.2v3M3.8 12h3M17.2 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1"/></>,
    anchor: <><circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 12a7 7 0 0 0 14 0M5 12H3l1.5 2M19 12h2l-1.5 2M8.5 9.5h7"/></>,
    log: <><path d="M5 4h11l3 3v13H5zM16 4v3h3"/><path d="M8 11h8M8 14.5h8M8 8h3"/></>,
    wrench: <><path d="M14.5 6.5a3.8 3.8 0 0 1-5 5l-5.2 5.2a1.8 1.8 0 0 0 2.6 2.6l5.2-5.2a3.8 3.8 0 0 0 5-5l-2.2 2.2-2-.4-.4-2z"/></>,
    coins: <><ellipse cx="9" cy="7" rx="5.5" ry="2.6"/><path d="M3.5 7v4.5c0 1.4 2.5 2.6 5.5 2.6"/><ellipse cx="15" cy="14.5" rx="5.5" ry="2.6"/><path d="M9.5 14v3c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-3"/></>,
    book: <><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5C20 4.7 19.3 4 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/></>,
    store: <><path d="M4 9.5 5.2 5h13.6L20 9.5M4 9.5h16M4 9.5v0a2.4 2.4 0 0 0 4 1.6 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4-1.6M5.5 11v9h13v-9M9.5 20v-5h5v5"/></>,
    search: <><circle cx="11" cy="11" r="6.2"/><path d="m20 20-3.6-3.6"/></>,
    share: <><circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="m8.2 10.9 7.1-3.6M8.2 13.1l7.1 3.6"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    arrowRight: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6"/></>,
    chevron: <><path d="m9 6 6 6-6 6"/></>,
    wind: <><path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h14a2.5 2.5 0 1 1-2.5 2.5M3 16h8a2 2 0 1 1-2 2"/></>,
    waves: <><path d="M3 8c1.5 0 1.5 1.5 3 1.5S7.5 8 9 8s1.5 1.5 3 1.5S13.5 8 15 8s1.5 1.5 3 1.5S19.5 8 21 8M3 13c1.5 0 1.5 1.5 3 1.5S7.5 13 9 13s1.5 1.5 3 1.5S13.5 13 15 13s1.5 1.5 3 1.5S19.5 13 21 13"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></>,
    thermo: <><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a3.5 3.5 0 1 1-4 0z"/><path d="M12 14V9"/></>,
    crew: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a2.6 2.6 0 0 1 0 5M17 14.5a5 5 0 0 1 3.5 4.5"/></>,
    pin: <><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></>,
    flag: <><path d="M6 21V4M6 5h11l-2 3 2 3H6"/></>,
    clock: <><circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3v4M16 3v4"/></>,
    route: <><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 16.5 16 7.5M6 15.8V11a3 3 0 0 1 3-3h2"/></>,
    engine: <><path d="M5 10h2V8h4v2h3l2-2h2v3h2v4h-2v3h-3l-2-2H7v-2H5z"/><path d="M9 10v4"/></>,
    sail: <><path d="M12 3v15M12 4c-3 3-5 8-5 14h5M12 4c3 3 5 8 5 14h-5M4 21h16"/></>,
    life: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/></>,
    shoe: <><path d="M3 15v-4l3-1 2 2 4-1c2 0 3 1.2 5 2.4 2 1.2 4 1.1 4 1.1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M6 10l1 2"/></>,
    shirt: <><path d="M8 4 4 7l2 3 2-1v9h8v-9l2 1 2-3-4-3-2 2h-4z"/></>,
    bottle: <><path d="M10 3h4v3l1 2v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8l1-2z"/><path d="M9 12h6"/></>,
    heart: <><path d="M12 20s-7-4.5-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7-.0c0 5-7 13-7 13z"/></>,
    check: <><path d="M5 12.5 10 17 19 7"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    alert: <><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.2"/></>,
    drop: <><path d="M12 3.5C8 9 6.5 11.5 6.5 14.5a5.5 5.5 0 0 0 11 0C17.5 11.5 16 9 12 3.5z"/></>,
    bolt: <><path d="M13 3 5 13h6l-1 8 8-10h-6z"/></>,
    layers: <><path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></>,
    box: <><path d="M12 3.2 20 7v10l-8 3.8L4 17V7z"/><path d="m4 7 8 3.8L20 7M12 10.8V20.6"/></>,
    phone: <><path d="M6 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V18a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 2-2z"/></>,
    mail: <><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></>,
    camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></>,
    download: <><path d="M12 3v11M8 10l4 4 4-4M5 19h14"/></>,
    info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/></>
  };
  return <Svg s={s} sw={sw} {...p}>{paths[name] || paths.info}</Svg>;
};

/* Compass rose — used as brand mark + watermark */
const CompassRose = ({ s = 34, sw = 1.4, ...p }) => (
  <svg width={s} height={s} viewBox="0 0 100 100" fill="none"
    stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" {...p}>
    <circle cx="50" cy="50" r="46" opacity="0.5"/>
    <circle cx="50" cy="50" r="38" opacity="0.3"/>
    {/* cardinal star */}
    <path d="M50 8 L57 43 L50 50 L43 43 Z" fill="currentColor" opacity="0.9" stroke="none"/>
    <path d="M50 92 L43 57 L50 50 L57 57 Z" fill="currentColor" opacity="0.45" stroke="none"/>
    <path d="M8 50 L43 43 L50 50 L43 57 Z" fill="currentColor" opacity="0.6" stroke="none"/>
    <path d="M92 50 L57 57 L50 50 L57 43 Z" fill="currentColor" opacity="0.6" stroke="none"/>
    {/* intercardinal */}
    <path d="M50 50 L74 26 L62 50 Z" fill="currentColor" opacity="0.25" stroke="none"/>
    <path d="M50 50 L26 74 L38 50 Z" fill="currentColor" opacity="0.25" stroke="none"/>
    <path d="M50 50 L74 74 L50 62 Z" fill="currentColor" opacity="0.18" stroke="none"/>
    <path d="M50 50 L26 26 L50 38 Z" fill="currentColor" opacity="0.18" stroke="none"/>
    <circle cx="50" cy="50" r="3.5" fill="currentColor" stroke="none"/>
  </svg>
);

Object.assign(window, { Svg, Icon, CompassRose });

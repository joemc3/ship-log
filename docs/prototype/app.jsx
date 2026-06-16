/* ============================================================
   App shell — nav, topbar, routing, search, share, mobile drawer
   ============================================================ */
const { useState, useEffect } = React;

const NAV = [
  { group: "Aboard", items: [{ id: "welcome", label: "Welcome", icon: "helm" }] },
  { group: "Find", items: [{ id: "search", label: "Search", icon: "search" }] },
  { group: "Operations", items: [
    { id: "logs", label: "Trip logs", icon: "log" },
    { id: "maintenance", label: "Maintenance", icon: "wrench" },
    { id: "inventory", label: "Inventory", icon: "box" },
    { id: "costs", label: "Costs", icon: "coins" }
  ] },
  { group: "Reference", items: [
    { id: "manuals", label: "Manuals", icon: "book" },
    { id: "vendors", label: "Vendors", icon: "store" }
  ] }
];
const PAGE_TITLE = { welcome: "Welcome", search: "Search", logs: "Trip logs", maintenance: "Maintenance", inventory: "Inventory", costs: "Costs", manuals: "Manuals", vendors: "Vendors" };

function App() {
  const [page, setPage] = useState("welcome");
  const [focus, setFocus] = useState(null); // {page, ref}
  const [searchPulse, setSearchPulse] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const overdue = window.DATA.maintenance.filter((m) => m.status === "overdue").length + window.invTasks().filter((t) => t.tone === "overdue").length;

  const navTo = (p, ref) => {
    setPage(p);
    setFocus(ref ? { page: p, ref } : null);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };
  const focusId = focus && focus.page === page ? focus.ref : null;
  const clearFocus = () => setFocus(null);
  const openSearch = () => { setPage("search"); setFocus(null); setNavOpen(false); window.scrollTo({ top: 0 }); setSearchPulse((p) => p + 1); };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
      if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderPage = () => {
    switch (page) {
      case "welcome": return <WelcomePage onShare={() => setShareOpen(true)} />;
      case "search": return <SearchPage pulse={searchPulse} onGo={(p, ref) => navTo(p, ref)} />;
      case "logs": return <LogsPage focusId={focusId} clearFocus={clearFocus} onOpenMaint={(id) => navTo("maintenance", id)} />;
      case "maintenance": return <MaintenancePage focusId={focusId} clearFocus={clearFocus} onOpenTrip={(id) => navTo("logs", id)} onOpenInventory={(id) => navTo("inventory", id)} />;
      case "inventory": return <InventoryPage focusId={focusId} clearFocus={clearFocus} onOpenCost={() => navTo("costs")} />;
      case "costs": return <CostsPage />;
      case "manuals": return <ManualsPage focusId={focusId} clearFocus={clearFocus} />;
      case "vendors": return <VendorsPage focusId={focusId} clearFocus={clearFocus} onOpenMaint={(id) => navTo("maintenance", id)} />;
      default: return null;
    }
  };

  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)}></div>}

      {/* Sidebar */}
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-row">
            <span className="brand-compass"><CompassRose s={40} /></span>
            <div>
              <div className="brand-name">Valkyrie</div>
              <div className="brand-sub">Ship's Log</div>
            </div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((grp) => (
            <React.Fragment key={grp.group}>
              <div className="nav-group-label">{grp.group}</div>
              {grp.items.map((it) => (
                <button key={it.id} className={`nav-item${page === it.id ? " active" : ""}`} onClick={() => navTo(it.id)}>
                  <span className="nav-ico"><Icon name={it.icon} s={19} /></span>
                  {it.label}
                  {it.id === "maintenance" && overdue > 0 && <span className="nav-badge">{overdue}</span>}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="share-btn" onClick={() => setShareOpen(true)}>
            <Icon name="share" s={16} />Share welcome page
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setNavOpen(true)}><Icon name="menu" s={20} /></button>
          <div className="crumbs">Valkyrie <span style={{ opacity: 0.4 }}>/</span> <b>{PAGE_TITLE[page]}</b></div>
          <button className="search-pill" onClick={openSearch}>
            <Icon name="search" s={17} />
            <span className="sp-label">Search the whole boat…</span>
            <kbd>⌘K</kbd>
          </button>
        </header>
        <main>{renderPage()}</main>
      </div>

      {shareOpen && <ShareModal onClose={() => setShareOpen(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

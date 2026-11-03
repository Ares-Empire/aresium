/* A read-only walk over the real demo screens and controls. Every step has English and German words. */
(function () {
  const open = (route) => window.AresiumPages.open(route);
  const L = window.AresiumLanguage;
  const steps = [
    [
      null,
      '.chart-host,.mob-graph',
      'Overview',
      'Übersicht',
      'The graph shows each month. Open a month to see its days.',
      'Der Graph zeigt jeden Monat. Öffne einen Monat, um seine Tage zu sehen.'
    ],
    [
      null,
      '.average-line',
      'Monthly average',
      'Monatsdurchschnitt',
      'The average counts finished months. The fixed part opens fixed costs.',
      'Der Durchschnitt zählt abgeschlossene Monate. Der fixe Anteil öffnet die Fixkosten.'
    ],
    [
      {
        screen: 'fixed',
        side: 'expenses'
      },
      '.fixed-row',
      'Fixed costs',
      'Fixkosten',
      'Rent, subscriptions and insurance, with their next payment and monthly share.',
      'Miete, Abos und Versicherungen, mit nächster Zahlung und monatlichem Anteil.'
    ],
    [
      {
        screen: 'fixed',
        side: 'income'
      },
      '.fixed-row',
      'Regular income',
      'Regelmäßige Einnahmen',
      'Regular money in is shown in the same way.',
      'Regelmäßige Geldeingänge werden genauso gezeigt.'
    ],
    [
      {
        screen: 'search'
      },
      '.page-field input',
      'Search',
      'Suchen',
      'Find a name you remember or the bank’s name. Best matches come first.',
      'Finde einen eigenen Namen oder den Banknamen. Die besten Treffer stehen zuerst.'
    ],
    [
      {
        screen: 'name',
        key: 'merchant:fictional dinner'
      },
      '.name-totals',
      'All with this name',
      'Alle mit diesem Namen',
      'One name has its own totals and months.',
      'Ein Name hat eigene Summen und Monate.'
    ],
    [
      {
        screen: 'name',
        key: 'merchant:fictional dinner',
        month: '2026-06'
      },
      '.txn-row',
      'Payments',
      'Zahlungen',
      'A month opens all payments of this name.',
      'Ein Monat öffnet alle Zahlungen dieses Namens.'
    ],
    [
      {
        screen: 'day',
        day: '2026-06-05'
      },
      '.recat-seg',
      'A day',
      'Ein Tag',
      'Open any day of the graph to see its spending and income.',
      'Öffne einen Tag im Graphen, um seine Ausgaben und Einnahmen zu sehen.'
    ],
    [
      {
        screen: 'payment',
        id: 'sample-dinner'
      },
      '.payback-detail',
      'Your share',
      'Dein Anteil',
      'The bank amount stays. Only your share counts after a linked payback.',
      'Der Bankbetrag bleibt. Nach einer verknüpften Rückzahlung zählt nur dein Anteil.'
    ],
    [
      {
        screen: 'payback',
        ids: ['sample-dinner']
      },
      '.payback-pick',
      'Money paid back',
      'Zurückgezahltes Geld',
      'Choose a suggestion or search. Nothing is linked without saving.',
      'Wähle einen Vorschlag oder suche. Ohne Speichern wird nichts verknüpft.'
    ],
    [
      {
        screen: 'payback',
        ids: ['sample-dinner', 'sample-course']
      },
      '.payback-pick',
      'Several payments',
      'Mehrere Zahlungen',
      'Tick payments on the other side. The summary fills the oldest expense first.',
      'Wähle Zahlungen der anderen Seite. Die Vorschau füllt die älteste Ausgabe zuerst.'
    ],
    [
      {
        screen: 'categoryPayments',
        cat: 'Restaurants',
        month: '2026-06'
      },
      '.selection-tools',
      'Select',
      'Auswählen',
      'Use checkboxes. Shift-click selects a range on a computer.',
      'Nutze die Kästchen. Am Computer wählt ein Klick mit Umschalttaste einen Bereich.'
    ],
    [
      {
        screen: 'batchCategory',
        ids: ['sample-dinner', 'sample-course']
      },
      '.recat-grid',
      'Category',
      'Kategorie',
      'Move or add all selected payments together, with one question for their shops.',
      'Verschiebe die Auswahl oder füge Kategorien hinzu, mit einer Frage für ihre Namen.'
    ],
    [
      {
        screen: 'rename',
        ids: ['sample-dinner']
      },
      '.page-field input',
      'Names',
      'Namen',
      'Name one payment or its shop. Future imports get the shop’s name too.',
      'Benenne eine Zahlung oder ihren Namen insgesamt. Künftige Importe erhalten den Namen auch.'
    ],
    [
      {
        screen: 'quickSort'
      },
      '.recat-grid',
      'Not sorted',
      'Nicht sortiert',
      'One category sorts a whole name. Skip and undo are there when needed.',
      'Eine Kategorie sortiert einen ganzen Namen. Überspringen und Rückgängig sind dabei.'
    ],
    [
      {
        screen: 'categories'
      },
      '.new-category,.category-setting',
      'Categories',
      'Kategorien',
      'Create, rename or remove categories. Each has a home side and an optional other-side offer.',
      "Lege Kategorien an, benenne sie um oder entferne sie. Jede hat eine "
      + "Seite und kann auf der anderen angeboten werden."
    ],
    [
      {
        screen: 'categoryPayments',
        cat: 'Restaurants',
        month: '2026-06'
      },
      '.selection-tools',
      'Add up names',
      'Namen zusammenzählen',
      'The add-up button shows one row per name. Selecting it selects its payments.',
      'Zusammenzählen zeigt eine Zeile pro Name. Die Auswahl wählt alle Zahlungen darin.'
    ],
    [
      {
        screen: 'cash'
      },
      '.name-totals',
      'Cash',
      'Bargeld',
      'The wallet view shows cash received, spent, withdrawn and still without receipts.',
      'Die Übersicht zeigt erhaltenes, ausgegebenes, abgehobenes und noch nicht belegtes Bargeld.'
    ],
    [
      {
        screen: 'cashEdit'
      },
      '.page-field input',
      'Add cash',
      'Bargeld eintragen',
      'Enter cash by hand and choose its source. The engine keeps it from counting twice.',
      'Trage Bargeld ein und wähle seine Quelle. Der Rechenkern verhindert doppeltes Zählen.'
    ],
    [
      {
        screen: 'categories'
      },
      '.payback-pick',
      'Graph',
      'Graph',
      'The graph can stay on and scroll away with the phone’s page.',
      'Der Graph kann eingeschaltet bleiben und mit der Seite auf dem Handy wegscrollen.'
    ],
    [
      null,
      '.btn-import,.mob-import-btn',
      'Import data',
      'Daten importieren',
      'Import a supported bank export. The demo sends and saves nothing.',
      'Importiere einen unterstützten Bankexport. Die Demo sendet und speichert nichts.'
    ],
    [
      {
        screen: 'help'
      },
      '.help-links',
      'Help',
      'Hilfe',
      'The import guide, contact, privacy and imprint are always available.',
      'Importhilfe, Kontakt, Datenschutz und Impressum sind immer erreichbar.'
    ],
  ];

  function Tour() {
    const handleIndex = () => setIndex(index === steps.length - 1 ? -1 : index + 1);
    const [index, setIndex] = React.useState(() => new URLSearchParams(location.search).has('tour') ? 0 : -1);
    React.useEffect(
      () => {
        const fn = () => setIndex(0);
        window.addEventListener('aresium:tour', fn);
        return () => window.removeEventListener('aresium:tour', fn);
      },
      []);
    React.useEffect(
      () => {
        if (index < 0)
          return;
        const step = steps[index];
        const navigation = setTimeout(
          () => {
            open(step[0]);
            if (!step[0])
              window.dispatchEvent(new Event('aresium:tour-home'));
          },
          0);
        let node;
        const timer = setTimeout(
          () => {
            node = [...document.querySelectorAll(step[1])].find((el) => el.getBoundingClientRect().width > 0);
            if (node) {
              node.scrollIntoView({
                block: 'center'
              });
              node.classList.add('tour-target');
            }
          },
          200);
        return () => {
          clearTimeout(navigation);
          clearTimeout(timer);
          node?.classList.remove('tour-target');
        };
      },
      [index]);
    if (index < 0)
      return null;
    const step = steps[index];
    const de = L.language === 'de';
    return ReactDOM.createPortal(
      <section
        className="tour-bar"
        role="dialog"
        aria-label={de ? 'Tour' : 'Tour'}
      >
        <div className="tour-caption">
          {index + 1}
          {" / "}
          {steps.length}
          {" · "}
          <b>
            {step[de ? 3 : 2]}
          </b>
        </div>
        <p>
          {step[de ? 5 : 4]}
        </p>
        <div className="selection-tools">
          <button
            className="md-edit"
            onClick={() => setIndex(-1)}
          >
            {L.t('Close')}
          </button>
          <button
            className="md-edit"
            disabled={index === 0}
            onClick={() => setIndex((v) => v - 1)}
          >
            {L.t('Back')}
          </button>
          <button
            className="recat-btn primary"
            onClick={handleIndex}
          >
            {index === steps.length - 1 ? L.t('Done') : de ? 'Weiter' : 'Next'}
          </button>
        </div>
      </section>,
      document.body);
  }
  window.AresiumTour = Tour;
})();

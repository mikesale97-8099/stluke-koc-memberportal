/*
 * Why Dues quick-link toggle
 * --------------------------
 * Controlled by the "Include Why Dues quicklink" row on the Assumptions tab.
 * Value "Yes" shows the link; anything else (No, blank, or the sheet can't be
 * reached) keeps it hidden. Loaded in <head> so the link never flashes on screen
 * before being hidden.
 */
(function () {
    // Hide immediately, before the page draws
    var style = document.createElement('style');
    style.textContent =
        '.nav-whydues { display:none !important; }' +
        'html.show-whydues .nav-whydues { display:flex !important; }';
    document.head.appendChild(style);

    var SHEET_ID = '1BXIzmI531yWJA7BYkATFrqED4nxict_pkScKadFNdUI';
    var ASSUMPTIONS_GID = '753284304';
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
              '/gviz/tq?tqx=out:json&gid=' + ASSUMPTIONS_GID;

    fetch(url)
        .then(function (res) { return res.text(); })
        .then(function (text) {
            var match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
            if (!match) return;
            var rows = JSON.parse(match[1]).table.rows;
            var row = rows.find(function (r) {
                var c = r.c[0];
                var label = c && (c.v || c.f);
                return label && String(label).trim().toLowerCase().indexOf('include why dues quicklink') === 0;
            });
            if (!row) return;
            var cell = row.c[1];
            var value = cell ? String(cell.v != null ? cell.v : (cell.f || '')).trim().toLowerCase() : '';
            if (value === 'yes' || value === 'y' || value === 'true') {
                document.documentElement.classList.add('show-whydues');
            }
        })
        .catch(function () { /* quiet fail — link stays hidden */ });
})();

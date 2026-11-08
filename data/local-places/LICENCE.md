# Licence and attribution

## OpenStreetMap

Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the
[Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
[Copyright and attribution](https://www.openstreetmap.org/copyright).

The local places lists in this directory (`de.json.gz`, `de.places.bin.gz`, `left-out.json.gz`,
`left-out.places.bin.gz`) are databases derived from OpenStreetMap. They are available under ODbL 1.0, not under the
repository's licence. If you change them or build another database from them and share it or use it publicly, that
database must also be under ODbL 1.0.

Source: the [Geofabrik Germany extract](https://download.geofabrik.de/europe/germany.html) of OpenStreetMap, data
date 2026-10-31 21:23:06 UTC. `build.json` records the extract's SHA-256 and the build counts; each list carries its
attribution, source, licence link and data date itself. The iPhone app's copy is offered for download at
https://aresium.de/osm/local-places-de.places.bin.gz.

## name-suggestion-index

The builder leaves out names found in the name-suggestion-index (BSD-3-Clause). That list of names is not part of
these databases; its pinned version is recorded in `build.json`, and its licence text is in
`src/engine/sorting/shops.de.json`.

## Everything else here

The reports, measurements and the README follow the repository's licence.

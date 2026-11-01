# Source licences and attribution

## OpenStreetMap

Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the
[Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
[Copyright and attribution](https://www.openstreetmap.org/copyright).

The OSM-derived evaluation database (OSM source facts, anonymised names and their rendered cases) is made
available under ODbL 1.0. Source IDs and classification tags identify the contributing features. Names have been
pseudonymised; payment dates, amounts, account details and bank renderings are invented, not OSM facts or real
transactions. The selection queries and mapping are supplied in this directory for reproducibility. Raw Overpass
responses are local ignored caches and are not redistributed. Download sample bounds are in manifest.json.
OSM's own tags are an independent initial label, not a guarantee of truth or sufficient bank-line evidence.

Overpass endpoints: https://overpass-api.de/api/interpreter, https://overpass.kumi.systems/api/interpreter,
https://overpass.private.coffee/api/interpreter. Only one query is in flight; a pause separates requests.

## name-suggestion-index

Version 8.0.20260918, https://github.com/osmlab/name-suggestion-index,
https://cdn.jsdelivr.net/npm/name-suggestion-index@8.0.20260918/dist/json/nsi.min.json
SHA-256: 85752fb28977082f6e631636f1e9b8f97513947f75aaf1338c47ffa87207f513.
Selected brand names and taxonomy tags derive from that release. BSD-3-Clause:

Copyright 2026, name-suggestion-index contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Invented material

The authored category guide, invented payments, renderers and evaluation code follow the repository's licence.
They do not contain private account data. Public brands are retained as brands, including brands named after a
founder. Personal-looking words in non-brand OSM names are replaced before versioned files are written.

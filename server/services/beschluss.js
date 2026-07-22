// Der feste Rahmen eines Gesellschafterbeschlusses. Eine Quelle der Wahrheit
// fuer Frontend-Vorschau (via API) und PDF — die KI schreibt nur `content`.

export function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// Beschlusstext aufraeumen: nummerierte Punkte (1., 2., ...) bekommen immer eine
// Leerzeile davor, damit sie nicht aneinanderkleben. Idempotent.
export function normalizeContent(s) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n') // doppelt-escapte Umbrueche mancher Modelle
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n(\d+[.)]\s)/g, '$1\n\n$2') // Leerzeile vor "N. " / "N) "
    .trim()
}

/**
 * @param {object} company companies-Row
 * @param {Array} shareholders shareholders-Rows in Positionsreihenfolge
 * @param {object} resolution resolutions-Row
 * @returns {{intro: string, shareholderList: string, outro: string, closing: string, placeDate: string}}
 */
// Rechtsform-abhaengige Textbausteine (rechtlich korrekte Formulierung).
const FORM = {
  gmbh: {
    capital: 'Das Stammkapital der Gesellschaft ist in voller Höhe vertreten.',
    register: 'Handelsregister',
    mgmt: 'die Geschäftsführung',
  },
  ug: {
    capital: 'Das Stammkapital der Gesellschaft ist in voller Höhe vertreten.',
    register: 'Handelsregister',
    mgmt: 'die Geschäftsführung',
  },
  ag: {
    capital: 'Das Grundkapital der Gesellschaft ist in voller Höhe vertreten.',
    register: 'Handelsregister',
    mgmt: 'den Vorstand',
  },
  gbr: {
    capital: 'Sämtliche Gesellschafter sind anwesend oder vertreten.',
    register: 'Gesellschaftsregister',
    mgmt: 'die geschäftsführenden Gesellschafter',
  },
  other: {
    capital: 'Sämtliche Gesellschafter sind anwesend oder vertreten.',
    register: 'Handelsregister',
    mgmt: 'die Geschäftsführung',
  },
}

export function buildFrame(company, shareholders, resolution) {
  const f = FORM[company.legal_form] ?? FORM.gmbh
  const court = (company.registry_court ?? '').trim()
  const hrb = (company.hrb ?? '').trim()
  // Genitiv: "Amtsgericht Charlottenburg" -> "des Amtsgerichts Charlottenburg"
  const courtGen = court.replace(/^Amtsgericht(?=\s)/, 'Amtsgerichts')
  // Eintragungs-Passage nur mit vorhandenen Daten (z.B. GbR ohne Register).
  let reg = ''
  if (court && hrb) reg = `, eingetragen im ${f.register} des ${courtGen} unter ${hrb}`
  else if (court) reg = `, eingetragen im ${f.register} des ${courtGen}`
  else if (hrb) reg = `, eingetragen im ${f.register} unter ${hrb}`
  const intro =
    `Unter Verzicht auf alle Formen und Fristen der Einberufung und Ankündigung ` +
    `halten die Gesellschafter der ${company.name}${reg},`
  const shareholderList = shareholders.map((s) => s.name).join(', ')
  const outro =
    `hiermit eine Gesellschafterversammlung ab. ${f.capital} Die Versammlung ist ` +
    `somit beschlussfähig und beschließt was folgt:`
  const closing =
    `Dieser Beschluss wird zur weiteren Bearbeitung und Umsetzung an ${f.mgmt} ` +
    `der ${company.name} übermittelt.`
  const placeDate = `${company.city}, ${fmtDate(resolution.date)}`
  return { intro, shareholderList, outro, closing, placeDate }
}

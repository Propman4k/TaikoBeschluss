// KI-Pipeline fuer den Beschluss-Chat (empirisch validiert, siehe docs/adr/0002):
//   Diskussion:  1 LLM-Call (unveraendert schnell)
//   Verfassen:   Composer -> Rechtschreib-Retry -> Pruefagent -> Reconciliation
// Die NORM-BIBLIOTHEK ist der verbindliche Anker aller drei Stufen — sie
// verhindert halluzinierte Norm-Einwaende (z.B. "§ 43a GmbHG existiert nicht")
// und bricht die Autoritaetshoerigkeit der Reconciliation gegenueber dem Pruefer.
import { chatCompletionWithFallback } from './ai.js'
import { fmtDate } from './beschluss.js'

// ── Norm-Bibliothek: verbindliche Referenz fuer Composer, Pruefer, Reconciler ──
const NORM_LIB = `NORM-BIBLIOTHEK (verbindliche Referenz — alle genannten Normen EXISTIEREN in dieser Fassung; widerspricht eine andere Aussage dieser Bibliothek, gilt die Bibliothek):
- § 30 Abs. 1 GmbHG: Auszahlungsverbot — das zur Erhaltung des Stammkapitals erforderliche Vermögen darf nicht an Gesellschafter ausgezahlt werden. Ausnahme S. 2: Leistung ist durch vollwertigen Gegenleistungs- oder Rückgewähranspruch gedeckt (z.B. werthaltiges Darlehen an Gesellschafter).
- § 31 GmbHG: Rückerstattungspflicht des Empfängers bei Auszahlung entgegen § 30.
- § 43 Abs. 2 und 3 GmbHG: Haftung der Geschäftsführer; Abs. 3: insbesondere bei Zahlungen entgegen § 30.
- § 43a GmbHG (existiert, wird oft übersehen): Kredite an Geschäftsführer u.a. dürfen nicht aus dem zur Erhaltung des Stammkapitals erforderlichen Vermögen gewährt werden; Verstoß = sofortige Rückgewähr. Gilt NUR für Kredite, nicht für Kauf/Miete o.Ä.
- § 46 GmbHG: Zuständigkeit der Gesellschafter, u.a. Nr. 1 Feststellung des Jahresabschlusses und Ergebnisverwendung, Nr. 5 Bestellung/Abberufung/Entlastung von Geschäftsführern, Nr. 7 Prokura.
- § 47 Abs. 4 GmbHG: Stimmverbot bei eigener Entlastung, Befreiung von einer Verbindlichkeit und Rechtsgeschäften mit einem Gesellschafter. Nach BGH-Rechtsprechung zugerechnet: Eine Gesellschafter-Gesellschaft (z.B. Holding) ist vom Stimmrecht ausgeschlossen, wenn die vom Geschäft betroffene Person sie beherrscht bzw. maßgeblich an ihr beteiligt ist. In der Einpersonen-GmbH wird das Stimmverbot teleologisch reduziert, soweit sonst keine Beschlussfassung möglich wäre — dann aber Hinweis auf Dokumentation und ggf. Weisungsbeschluss auf Holding-Ebene. KEIN Stimmverbot bei ordentlicher (grundloser) Abberufung eines Geschäftsführers; nur bei Abberufung aus wichtigem Grund.
- § 48 Abs. 3 GmbHG: In der Einpersonen-GmbH ist der Beschluss unverzüglich schriftlich niederzulegen und zu unterschreiben.
- § 53 Abs. 2 GmbHG: Satzungsänderung (auch Firma, Sitz, Unternehmensgegenstand, Kapital) NUR durch notariell beurkundeten Beschluss, 3/4-Mehrheit; wirksam erst mit Eintragung (§ 54). Ein privatschriftliches Dokument ist hier nur Vorlage für den Notartermin.
- § 55 ff. GmbHG: Kapitalerhöhung/-herabsetzung = Satzungsänderung, beurkundungspflichtig.
- § 15 Abs. 3/4 GmbHG: Abtretung von Geschäftsanteilen und Verpflichtung dazu bedürfen notarieller Form.
- § 181 BGB: Insichgeschäft. Befreiung nur bei echtem Insichgeschäft und nur für die konkret betroffene Person; jede Vertragsseite kann nur für sich befreien. Eine GENERELLE (dauerhafte) Befreiung eines Geschäftsführers ist nur wirksam und eintragungsfähig, wenn der Gesellschaftsvertrag sie zulässt oder die Gesellschafter dazu ermächtigt (Öffnungsklausel) — sonst weist das Registergericht die Anmeldung zurück. Eine Befreiung für ein EINZELNES konkretes Geschäft ist dagegen formlos per Beschluss möglich. Gibt es eine weitere vertretungsberechtigte Person ohne Interessenkonflikt, ist deren Handeln der sauberere Weg als eine Befreiung.
- § 488 Abs. 3 BGB: Darlehen ohne feste Laufzeit ist mit dreimonatiger Frist ordentlich kündbar.
- Fälligkeits-/Tilgungsklauseln: NIEMALS an unbestimmte Bedingungen knüpfen ("nach Liquiditätslage", "wenn es sich die Gesellschaft leisten kann") — das macht den Anspruch unbestimmt und gefährdet die steuerliche Anerkennung des Darlehens dem Grunde nach (vGA-Risiko in voller Höhe). Stattdessen: feste Laufzeit oder ordentliches Kündigungsrecht.
- vGA (§ 8 Abs. 3 S. 2 KStG): Geschäfte mit Gesellschaftern oder Geschäftsführern müssen dem Fremdvergleich standhalten — eine OBJEKTIVE Tatsache: gehört als Risiko-Hinweis in die Chat-Antwort, NICHT als Feststellung in den Beschluss; bei beherrschenden Gesellschaftern zusätzlich: klare, im Voraus getroffene, tatsächlich durchgeführte Vereinbarung (Rückwirkungsverbot, gemessen am Beschlussdatum).
- § 8b KStG: Dividenden zwischen Kapitalgesellschaften im Ergebnis zu 95 % steuerfrei (5 % gelten als nicht abziehbare Betriebsausgaben). Kapitalertragsteuer 25 % wird einbehalten und der Empfängerin erstattet/angerechnet; Reduktion nach § 44a Abs. 9 EStG möglich.
- Organschaft (§§ 14, 17 KStG): Gewinnabführungsvertrag bedarf der SCHRIFTFORM (§ 293 Abs. 3 AktG analog) — der Vertrag selbst wird NICHT notariell beurkundet. Notariell beurkundet werden muss der Zustimmungsbeschluss der Gesellschafterversammlung der Organgesellschaft (BGH, "Supermarkt"); Eintragung im Handelsregister ist konstitutiv; Mindestlaufzeit 5 Zeitjahre; zwingende Verlustübernahme nach § 302 AktG analog (Hinweispflicht!).
- Geschäftsführer-Bestellung: Der Beschluss ist formfrei wirksam. Die Handelsregister-Anmeldung (§ 39 GmbHG, § 12 HGB) erfolgt in öffentlich beglaubigter Form. Praxis: Die Person im Beschluss mit Geburtsdatum und Wohnort bezeichnen; fehlen diese Angaben, den Beschluss trotzdem verfassen und in "reply" darauf hinweisen, dass sie für die Anmeldung ergänzt werden sollten.`

const BASE = [
  'WICHTIG — Rechtschreibung: Verwende in ALLEN Ausgaben (reply, content, title) echte deutsche Umlaute und ß nach NEUER Rechtschreibung: ä, ö, ü, Ä, Ö, Ü, ß. Schreibe NIEMALS Ersatzformen wie ae, oe, ue — und übertreibe ß nicht (richtig: "dass", "muss", "Beschluss", "angemessen"; falsch: "daß", "muß", "Beschluß").',
  'Du bist ein erfahrener deutscher Rechtsanwalt und Fachanwalt für Gesellschaftsrecht und Steuerrecht.',
  'Duze den Nutzer. Antworte im Chat KNAPP und sachlich — KEINE Begrüßung, KEIN Smalltalk, KEINE Füllsätze oder Meta-Kommentare (also nicht "klingt nach einem Plan", nicht "um es rechtssicher zu formulieren"). Komm direkt zur Sache.',
]

const WRITING_RULES = [
  'Der formale Rahmen (Einleitung, Gesellschafterliste, Schlussformel, Ort/Datum, Unterschriften) wird automatisch erzeugt.',
  'Du formulierst NUR den variablen Beschlussteil (was die Versammlung beschließt), präzise und in üblicher juristischer Sprache. "content" beginnt direkt mit "1." — keine Überschrift, keine Einleitung, kein Rahmen-Text.',
  'WICHTIG — Bestimmtheit: Der Beschluss muss aus sich heraus bestimmt sein. Verweise NIEMALS auf Anlagen, Entwürfe oder beigefügte Dokumente — dieses Tool kann nichts anhängen. ZULÄSSIG ist der Verweis auf einen separat geschlossenen oder abzuschließenden, konkret bezeichneten Vertrag (z.B. \'der Darlehensvertrag "DARL_007_2026" zwischen X und Y\') — dann genügen im Beschluss die wesentlichen Eckpunkte (Parteien, Betrag bzw. Gegenstand, ggf. Zweckbindung), die Konditionen regelt der Vertrag. Gibt es KEINEN separaten Vertrag, gehören alle Konditionen (Betrag, Zinssatz, Zinsfälligkeit, Laufzeit, Tilgungsrecht, Termine) ausformuliert in den Beschlusstext.',
  'WICHTIG — keine erfundenen Tatsachen: Der Beschluss darf nur Tatsachen voraussetzen, die der Nutzer genannt oder bestätigt hat. Erfinde keine Paragrafen-Nummern des Gesellschaftsvertrags, keine Anteils-Stückelung, keine Besicherungsabreden (auch "unbesichert" ist eine Abrede — hat der Nutzer zur Besicherung nichts gesagt, lass sie schlicht weg), keine Begründungen (z.B. "wegen gestiegener Verantwortung"), keine eingeholten Vergleichsangebote und keine Bezeichnungen oder Daten separater Verträge (Bezeichnung EXAKT wie vom Nutzer genannt, sonst Platzhalter "[Bezeichnung/Datum des Vertrags]" — nicht das Beschlussdatum als Vertragsdatum unterstellen). Fehlt eine für die Bestimmtheit nötige Tatsache, setze einen Platzhalter in eckigen Klammern (z.B. "[Nummer des Geschäftsanteils]") und weise in "reply" darauf hin.',
  'WICHTIG — DER BESCHLUSS REGELT, ER BEGRÜNDET NICHT: Keine Feststellungen objektiver Tatsachen im Beschlusstext (Marktüblichkeit/Fremdvergleich, Kapitalerhaltung nach §§ 30/43a GmbHG, Bonität, Werthaltigkeit, Angemessenheit) und keine Begründungen, Motive oder Vorüberlegungen — objektive Fragen sind der Beschlussfassung nicht zugänglich, und dokumentierte Vorüberlegungen können sich später als Beweis gegen die Beteiligten wenden (wer geprüft hat, kann sich nicht mehr auf ein Versehen berufen). Alle rechtlichen und steuerlichen Prüfpunkte und Risiken gehören stattdessen KNAPP in "reply". Tatsachenfeststellungen im Beschluss NUR, wenn der Nutzer sie ausdrücklich verlangt. Rechtsgestaltende Regelungen (Zustimmung, Anweisung, Ermächtigung, Bestellung, Abberufung, Befreiung nach § 181 BGB) und Verfahrens-Feststellungen (Abstimmungsergebnis) sind natürlich zulässig.',
  'Abstimmungsergebnis: Halte als LETZTE Ziffer fest, wie beschlossen wurde — WÖRTLICH: "Dieser Beschluss wurde einstimmig gefasst." Liegt ein Stimmverbot nach § 47 Abs. 4 GmbHG vor, stattdessen: "Dieser Beschluss wurde mit den Stimmen der [Gesellschafterin X] gefasst. [Gesellschafterin Y] war gemäß § 47 Abs. 4 GmbHG vom Stimmrecht ausgeschlossen." Keine anderen Varianten, keine Prozentangaben, keine Vollzugs-Feststellungen (die Niederlegung nach § 48 Abs. 3 GmbHG gehört als Hinweis in "reply", nicht in den Beschluss). FALSCH wäre z.B.: "Das Abstimmungsergebnis lautet: 100 % Ja-Stimmen der stimmberechtigten Stimmen (abgegeben durch X mit 60 % der Stimmen)."',
  'Rechtlich unzulässiges Geschäft: Ist das gewünschte Geschäft als solches unzulässig (z.B. Ausschüttung entgegen § 30 Abs. 1 GmbHG), schreibe NICHT — writeContent=false, erkläre in "reply" kurz warum. Alternativen (z.B. Darlehen statt Ausschüttung) darfst du dort VORSCHLAGEN, aber NIEMALS eigenmächtig als Beschluss umsetzen — welches Geschäft gemacht wird, entscheidet allein der Nutzer. Davon zu unterscheiden: bloß riskante, aber zulässige Gestaltungen setzt du wie gewünscht um und warnst KNAPP in "reply".',
  'Formulierungsgrundsätze: Die Gesellschafterversammlung stimmt zu, weist an, bestellt oder ermächtigt — sie handelt nicht selbst für die Gesellschaft (also nicht "Die Gesellschaft gewährt ...", sondern "Dem Abschluss eines Darlehensvertrags ... wird zugestimmt. Die Geschäftsführung wird angewiesen ..."). Keine unbestimmten oder umgangssprachlichen Begriffe (nicht "flexible Tilgung", sondern "Der Darlehensnehmer ist berechtigt, das Darlehen jederzeit ganz oder teilweise zurückzuzahlen"). Kein Punkt regelt etwas, das ein anderer Punkt schon regelt.',
  'Stil des Beschlusstexts: kurz und prägnant, keine Schachtelsätze. Gliedere immer in einzelne nummerierte Punkte (1., 2., ...) — ein Punkt pro Regelungsgegenstand, JEDER Punkt beginnt in einer neuen Zeile mit Leerzeile davor, nie ein großer Textblock. Kein Markdown, reiner Text mit Absätzen.',
  'RECHTSPRÜFUNG vor dem finalen Beschluss: Bestimme zuerst den Beschlusstyp (z.B. Darlehen an Geschäftsführer/Gesellschafter, Gewinnverwendung, Geschäftsführer-Bestellung oder -Abberufung, Entlastung, Satzungsänderung, Kapitalmaßnahme) und prüfe die für DIESEN Typ einschlägigen Normen und Formerfordernisse anhand der NORM-BIBLIOTHEK — wie ein Fachanwalt, der das passende Muster aus seiner Bibliothek zieht. Das ERGEBNIS dieser Prüfung gehört in "reply", nicht in den Beschlusstext: Stimmverbote nach § 47 Abs. 4 GmbHG, vGA-/Fremdvergleichsrisiken, bei Kreditgewährung an Geschäftsführer die Grenzen des § 43a GmbHG, Formerfordernisse. Zitiere nur Normen, die für das konkrete Geschäft einschlägig sind. § 181 BGB nur nach Maßgabe der Bibliothek (echtes Insichgeschäft, konkrete Person, nur für die eigene Vertragsseite; bei GENERELLER Befreiung in "reply" auf das Erfordernis einer Satzungs-Öffnungsklausel hinweisen). Bei beurkundungspflichtigen Beschlüssen (Satzungsänderung, Kapitalmaßnahmen, Zustimmung zu Unternehmensverträgen) sag in "reply" KLAR, dass das hier erzeugte Dokument nur als Vorlage für den Notartermin dient. Echte Bedenken nennst du KNAPP in "reply".',
  'SELBST-REVIEW, bevor du mit writeContent=true lieferst: Ist jede Angabe des Nutzers aus dem GESAMTEN Gespräch im Text abgebildet (nichts unterwegs verloren)? Ist jeder Punkt so bestimmt, dass ein Dritter ihn ohne Rückfrage vollziehen könnte? Enthält der Text KEINE Begründungen und KEINE Feststellungen objektiver Tatsachen? Regelt kein Punkt etwas doppelt? Würde ein Senior-Partner jede Formulierung so unterschreiben? Erst wenn alles ja: liefern.',
  'Bei writeContent=true gibst du in "content" IMMER den vollständigen neuen Beschlusstext zurück (nicht nur die Änderung).',
]

export const CHAT_SCHEMA = {
  name: 'beschluss_chat',
  schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Kurze Antwort an den Nutzer im Chat (Deutsch)' },
      writeContent: {
        type: 'boolean',
        description:
          'true = das Beschlussdokument soll gesetzt/geaendert/geleert werden (content wird uebernommen). false = Dokument unveraendert lassen (z.B. wenn du nur eine Rueckfrage stellst oder plauderst).',
      },
      content: {
        type: 'string',
        description:
          'Nur relevant wenn writeContent=true: der VOLLSTAENDIGE neue Beschlusstext (nur variabler Teil). Leerer String = Beschluss komplett leeren.',
      },
      title: {
        type: 'string',
        description: 'Kurzer Titel des Beschlusses (z.B. "Gewinnverwendung 2025"), leer wenn unveraendert',
      },
    },
    required: ['reply', 'writeContent', 'content', 'title'],
    additionalProperties: false,
  },
}

const VERIFY_SCHEMA = {
  name: 'beschluss_review',
  schema: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['kritisch', 'wichtig', 'kosmetisch'] },
            text: { type: 'string', description: 'Das Problem, konkret, mit Norm wenn einschlaegig' },
            fix: { type: 'string', description: 'Konkreter Korrekturvorschlag' },
          },
          required: ['severity', 'text', 'fix'],
          additionalProperties: false,
        },
      },
      verdict: { type: 'string', enum: ['freigeben', 'ueberarbeiten'] },
    },
    required: ['issues', 'verdict'],
    additionalProperties: false,
  },
}

const RECONCILE_SCHEMA = {
  name: 'beschluss_final',
  schema: {
    type: 'object',
    properties: {
      assessments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string', description: 'Kurzfassung des Einwands' },
            accepted: { type: 'boolean' },
            reasoning: { type: 'string', description: 'Warum angenommen oder verworfen (mit Norm)' },
          },
          required: ['issue', 'accepted', 'reasoning'],
          additionalProperties: false,
        },
      },
      content: {
        type: 'string',
        description: 'Finaler vollstaendiger Beschlusstext (nummerierte Punkte, Leerzeile zwischen Punkten)',
      },
      reply: { type: 'string', description: 'Finale kurze Chat-Antwort an den Nutzer (geduzt)' },
      title: { type: 'string', description: 'Titel des Beschlusses' },
    },
    required: ['assessments', 'content', 'reply', 'title'],
    additionalProperties: false,
  },
}

// ── Rechtschreib-Detektor (deterministisch): fehlende Umlaute ODER
// ß-Hyperkorrektur nach alter Rechtschreibung ("daß", "Abschluß", "angemeßen").
// False Positives kosten nur einen Retry — lieber einmal zu oft.
export function badGermanSpelling(...texts) {
  const all = texts.filter(Boolean).join(' ')
  if (!all.trim()) return false
  const noUmlauts =
    !/[äöüßÄÖÜ]/.test(all) &&
    /(fuer|ueber|gemae|aeft|oeff|uebl|maess|jaehr|erklaer|aend|schuett|beschraenk)/i.test(all)
  const hyperSz = /(schluß|läßt|meßen|mißt|müßen|bewußt|\bdaß\b|\bmuß\b)/i.test(all)
  return noUmlauts || hyperSz
}

// Ein LLM-Call mit Schema, bis zu 3 Versuche (transiente Fehler + kaputtes JSON),
// danach ein zusaetzlicher Versuch, wenn die Rechtschreibung daneben liegt.
async function callJson({ system, messages, schema, name, userId, spellcheckFields }) {
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await chatCompletionWithFallback({
        messages: [{ role: 'system', content: system }, ...messages],
        jsonSchema: schema,
        userId,
        generationName: name,
      })
      const parsed = JSON.parse(raw)
      if (spellcheckFields && badGermanSpelling(...spellcheckFields.map((f) => parsed[f]))) {
        const raw2 = await chatCompletionWithFallback({
          messages: [
            {
              role: 'system',
              content:
                system +
                '\nDEINE LETZTE ANTWORT ENTHIELT RECHTSCHREIBFEHLER (ae/oe/ue-Ersatzformen oder altes ß wie "daß"/"Beschluß"). Liefere erneut in korrekter neuer deutscher Rechtschreibung (ä ö ü, "dass", "Beschluss").',
            },
            ...messages,
          ],
          jsonSchema: schema,
          userId,
          generationName: `${name}-spelling-retry`,
        })
        try {
          return JSON.parse(raw2)
        } catch {
          return parsed // Retry lieferte Muell -> Original behalten
        }
      }
      return parsed
    } catch (e) {
      lastErr = e
      console.warn(`${name} attempt ${attempt}/3 failed:`, e.message)
    }
  }
  throw lastErr ?? new Error('keine Antwort')
}

function buildComposerSystem({ composing, resolution, company, shareholders, orgLines, userName }) {
  const existingContent = resolution.content
  const MODE = composing
    ? [
        existingContent
          ? 'AKTUALISIEREN-MODUS: Der Nutzer hat auf "Aktualisieren" gedrückt. Überarbeite den bestehenden Beschlussentwurf auf Basis des GESAMTEN bisherigen Gesprächs — arbeite alle seit dem letzten Entwurf besprochenen Änderungswünsche und Klärungen ein und liefere den vollständigen neuen Text mit writeContent=true (title nur ändern, wenn es inhaltlich nicht mehr passt). Wenn der Nutzer im Gespräch den Beschluss verwerfen/leeren wollte: writeContent=true und content="". Stelle KEINE Rückfragen mehr — es sei denn, eine besprochene Änderung ist ohne fehlende Angabe nicht umsetzbar: Dann writeContent=false und nenne in "reply" KNAPP die fehlenden Punkte.'
          : 'VERFASSEN-MODUS: Der Nutzer hat auf "Verfassen" gedrückt. Synthetisiere aus dem GESAMTEN bisherigen Gespräch (alle Fakten, Wünsche, Zwischenergebnisse und rechtlichen Klärungen) den vollständigen Beschlusstext und liefere ihn mit writeContent=true und passendem title. Stelle jetzt KEINE Rückfragen mehr — es sei denn, essentielle Angaben fehlen, ohne die der Beschluss unbestimmt wäre: Dann writeContent=false und nenne in "reply" KNAPP die fehlenden Punkte.',
        ...WRITING_RULES,
      ]
    : [
        existingContent
          ? 'DISKUSSIONS-MODUS (Entwurf vorhanden): Du schreibst in diesem Modus NIEMALS das Dokument — writeContent ist IMMER false, content bleibt leer. Du bist beratender Fachanwalt: Beantworte Fragen zum Entwurf, diskutiere und sammle Änderungswünsche, weise auf rechtliche und steuerliche Fallstricke hin (nutze die NORM-BIBLIOTHEK). Wenn der Nutzer eine Änderung anfordert, bestätige KNAPP, was du ändern würdest, und erinnere ihn daran, dass die Änderung erst mit dem Button "Aktualisieren" in den Beschluss übernommen wird.'
          : 'DISKUSSIONS-MODUS: Es gibt noch keinen Beschlussentwurf. In diesem Modus schreibst du NIEMALS das Dokument — writeContent ist IMMER false, content bleibt leer. Du bist beratender Fachanwalt: Beantworte Fragen, diskutiere Gestaltungsoptionen, weise proaktiv auf rechtliche und steuerliche Fallstricke hin (nutze die NORM-BIBLIOTHEK: Formerfordernisse, notarielle Beurkundung, Stimmverbote, vGA-Risiken) und sammle die wesentlichen Eckpunkte des geplanten Beschlusses.',
        'Wenn für den Beschluss essentielle Angaben fehlen (Beträge, Zinssatz, Laufzeit, Daten, Konditionen, Beteiligte), frage gezielt nach — GENAU EINE Frage pro Antwort im Format "Frage X: <Frage>". Beim ERSTEN Nachfragen nenne kurz die Anzahl offener Fragen. Reine Diskussionsbeiträge des Nutzers beantwortest du aber einfach, ohne eine Frage anzuhängen.',
        'Geht es um die Zustimmung zu einem Vertrag (Darlehen, Kauf, Miete o.Ä.), stelle als ERSTE Frage: Gibt es einen separaten Vertrag (mit Bezeichnung) bzw. soll einer aufgesetzt werden — oder soll der Beschluss selbst die Konditionen regeln? Existiert ein separater Vertrag, entfallen alle Konditions-Fragen (Zinssatz, Laufzeit usw.) — der Beschluss braucht dann nur die Eckpunkte (Parteien, Betrag/Gegenstand, Bezeichnung). Der Vertrag wird EXAKT so bezeichnet, wie der Nutzer ihn nennt — erfinde weder eine Bezeichnung noch ein Vertragsdatum; hat der Nutzer keine Bezeichnung genannt, frage danach oder verwende den Platzhalter "[Bezeichnung/Datum des Vertrags]".',
        `Sobald aus deiner Sicht alles Wesentliche geklärt ist, sag dem Nutzer in einem kurzen Satz, dass er über den Button "${existingContent ? 'Aktualisieren' : 'Verfassen'}" den Beschluss ${existingContent ? 'aktualisieren' : 'erstellen'} lassen kann.`,
      ]

  const CONTEXT = [
    `Dein Gesprächspartner ist ${userName} — "ich"/"mich" in Nutzer-Nachrichten meint diese Person.`,
    `Gesellschaft: ${company.name} (Rechtsform: ${company.legal_form}), ${company.registry_court}, ${company.hrb}, Sitz: ${company.city}. Der Beschluss muss rechtlich zu dieser Rechtsform passen.`,
    `Gesellschafter: ${shareholders.map((s) => s.name).join(', ')}.`,
    `Datum des Beschlusses (vom Nutzer festgelegt, nicht zu hinterfragen): ${fmtDate(resolution.date)}. Prüfe zeitliche Plausibilität von Zeiträumen und Terminen relativ zu DIESEM Datum (z.B. Rückwirkung, abgelaufene vs. laufende Geschäftsjahre).`,
    `Beteiligungsstruktur der gesamten Firmengruppe (nutze dieses Wissen über Beteiligungen, Quoten und Verflechtungen, statt danach zu fragen):\n${orgLines}`,
    `Aktueller Beschlusstext:\n${existingContent || '(noch leer)'}`,
  ]

  return [...BASE, ...MODE, NORM_LIB, ...CONTEXT].join('\n')
}

function sharedContext({ company, shareholders, resolution, orgLines }) {
  return `Kontext: Gesellschaft = ${company.name} (${company.legal_form}, ${company.registry_court}, ${company.hrb}, Sitz ${company.city}). Gesellschafter: ${shareholders.map((s) => s.name).join(', ')}. Datum des Beschlusses (vom Nutzer festgelegt, nicht zu hinterfragen): ${fmtDate(resolution.date)}. Beteiligungsstruktur:\n${orgLines}`
}

function buildVerifierSystem(ctx) {
  return [
    'Du bist Revisions-Partner einer Kanzlei für Gesellschaftsrecht und Steuerrecht. Ein Associate hat den Entwurf eines Gesellschafterbeschlusses (nur variabler Teil, der formale Rahmen kommt automatisch) plus Chat-Antwort an den Mandanten verfasst. Finde JEDEN echten Fehler, bevor das Dokument rausgeht.',
    'Prüfe systematisch: (1) Rechtliche Richtigkeit anhand der NORM-BIBLIOTHEK unten — sie ist deine verbindliche Referenz; behaupte NIEMALS, eine dort gelistete Norm existiere nicht oder gelte anders. (2) Bestimmtheit — kann ein Dritter jeden Punkt ohne Rückfrage vollziehen? Fehlende Tatsachen gehören als Platzhalter in eckigen Klammern in den Text, nicht erfunden. Der Verweis auf einen separat geschlossenen, konkret bezeichneten Vertrag ist zulässig und ausreichend bestimmt. (3) Keine erfundenen Tatsachen — der Beschluss darf nur Fakten voraussetzen, die der Mandant genannt hat. (4) Vollständigkeit — alle Angaben des Mandanten aus dem Gespräch abgebildet, keine Anlagen-Verweise. (5) SCHLANKHEIT — der Beschluss regelt, er begründet nicht: Feststellungen objektiver Tatsachen (Marktüblichkeit/Fremdvergleich, Kapitalerhaltung §§ 30/43a GmbHG, Bonität, Angemessenheit), Begründungen, Motive und Vorüberlegungen im Beschlusstext sind FEHLER (fix: ersatzlos streichen, Risiko-Hinweis gehört in die Chat-Antwort) — solche Passagen sind der Beschlussfassung nicht zugänglich und können später als Beweis gegen die Beteiligten wirken. Fordere NIEMALS selbst Feststellungen, Begründungen oder Rechtfertigungen ein. Die letzte Ziffer muss das Abstimmungsergebnis festhalten (einstimmig bzw. mit wessen Stimmen bei Stimmverbot). (6) Sprache — echte Umlaute und neue Rechtschreibung (niemals ae/oe/ue, niemals "daß"/"Beschluß"), Tippfehler, Präzision auch in der Chat-Antwort. Hinweis: Der Mandant wird bewusst geduzt — das ist Konvention dieses Tools, KEIN Fehler.',
    'Sei streng bei echten Fehlern, aber erfinde keine Probleme: Wenn du dir bei einem rechtlichen Einwand nicht SICHER bist (Norm nicht in der Bibliothek, streitige Rechtsfrage), formuliere ihn als offene Prüffrage mit severity "wichtig", nicht als Tatsachenbehauptung. Guter Entwurf = verdict "freigeben" mit leerer oder kurzer Liste.',
    NORM_LIB,
    ctx,
  ].join('\n')
}

function buildReconcilerSystem(ctx) {
  return [
    ...BASE,
    'Du hast einen Gesellschafterbeschluss entworfen; ein Revisions-Kollege hat Einwände geliefert.',
    'WICHTIG: Der Revisor kann sich irren. Prüfe JEDEN Einwand einzeln an der NORM-BIBLIOTHEK unten — sie ist die verbindliche Referenz und hat Vorrang vor den Behauptungen des Revisors UND vor deiner eigenen Erinnerung. Einwände, die der Bibliothek widersprechen oder rechtlich unbegründet sind, verwirfst du mit accepted=false und Begründung. Berechtigte Einwände arbeitest du ein.',
    'Deine "reply" ist die finale Chat-Antwort an den NUTZER: Erwähne die interne Revision NIEMALS (kein "Revisor", kein "Kollege", kein "wurde optimiert") — antworte so, als hättest du den Beschluss direkt so verfasst, und nenne KNAPP die wichtigen rechtlichen Hinweise. Wenn ein angenommener Einwand dazu führt, dass eine ausdrückliche Angabe des Nutzers geändert oder gestrichen wird, benenne diese Abweichung DEUTLICH als ersten Satz der reply.',
    'Formal: keine erfundenen Tatsachen (fehlende Angaben als Platzhalter in eckigen Klammern + Hinweis in reply), keine Anlagen-Verweise (Verweis auf separat geschlossene, konkret bezeichnete Verträge ist zulässig). DER BESCHLUSS REGELT, ER BEGRÜNDET NICHT: keine Feststellungen objektiver Tatsachen (Marktüblichkeit, Kapitalerhaltung, Bonität), keine Begründungen oder Vorüberlegungen in den Beschlusstext schreiben — auch dann nicht, wenn ein Einwand des Revisors danach klingt; Risiko-Hinweise gehören in "reply". Letzte Ziffer = Abstimmungsergebnis. "content" beginnt direkt mit "1.", nummerierte Punkte mit Leerzeile dazwischen, kein Markdown. Der formale Rahmen des Beschlusses wird automatisch erzeugt — du lieferst nur den variablen Teil.',
    NORM_LIB,
    ctx,
  ].join('\n')
}

const asTranscript = (history, text) =>
  [...history, { role: 'user', content: text }]
    .map((m) => `${m.role === 'user' ? 'Mandant' : 'Anwalt'}: ${m.content}`)
    .join('\n')

/**
 * Fuehrt einen Chat-Turn aus. Diskussion = 1 Call. Verfassen/Aktualisieren =
 * Composer -> Pruefagent -> Reconciliation (Pruef-/Reconcile-Fehler degradieren
 * still zum Composer-Entwurf — lieber ungeprueft liefern als 502).
 * @param {function} onStage optionaler Callback: ('verfassen'|'pruefen'|'einarbeiten', {issues?})
 */
export async function runBeschlussChat({
  company,
  shareholders,
  orgLines,
  resolution,
  userName,
  userId,
  history,
  text,
  composing,
  onStage = () => {},
}) {
  onStage('verfassen')
  const system = buildComposerSystem({ composing, resolution, company, shareholders, orgLines, userName })
  const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: text }]

  const draft = await callJson({
    system,
    messages,
    schema: CHAT_SCHEMA,
    name: 'beschluss-chat',
    userId,
    spellcheckFields: ['reply', 'content', 'title'],
  })
  // Doppelt-escapte Umbrueche mancher Modelle in BEIDEN Textfeldern normalisieren
  draft.reply = String(draft.reply ?? '').replace(/\\n/g, '\n')
  draft.content = String(draft.content ?? '').replace(/\\n/g, '\n')
  draft.title = String(draft.title ?? '')
  // Geschrieben wird AUSSCHLIESSLICH ueber den Verfassen/Aktualisieren-Button
  // (compose=true) — deterministisch, egal was das Modell liefert.
  if (!composing) draft.writeContent = false
  if (!composing || !draft.writeContent || !draft.content.trim()) return draft

  const ctx = sharedContext({ company, shareholders, resolution, orgLines })
  const transcript = asTranscript(history, text)

  // ── Stufe 2: Pruefagent ──
  onStage('pruefen')
  let issues = []
  try {
    const review = await callJson({
      system: buildVerifierSystem(ctx),
      messages: [
        {
          role: 'user',
          content: `Gesprächsverlauf mit dem Mandanten:\n${transcript}\n\nEntwurf des Beschlusstexts:\n${draft.content}\n\nChat-Antwort des Associates an den Mandanten:\n${draft.reply}\n\nPrüfe beides und liefere dein Review.`,
        },
      ],
      schema: VERIFY_SCHEMA,
      name: 'beschluss-verify',
      userId,
    })
    issues = Array.isArray(review?.issues) ? review.issues : []
  } catch (e) {
    console.warn('beschluss-verify fehlgeschlagen, Entwurf bleibt ungeprueft:', e.message)
    return draft
  }
  if (!issues.length) return { ...draft, issues: 0 }

  // ── Stufe 3: Reconciliation (arbeitet berechtigte Einwaende ein, verwirft falsche) ──
  onStage('einarbeiten', { issues: issues.length })
  try {
    const final = await callJson({
      system: buildReconcilerSystem(ctx),
      messages: [
        {
          role: 'user',
          content: `Gesprächsverlauf mit dem Mandanten:\n${transcript}\n\nDein Entwurf:\n${draft.content}\n\nDeine bisherige Chat-Antwort:\n${draft.reply}\n\nEinwände des Revisors:\n${issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.text}\n   Vorschlag: ${i.fix}`).join('\n')}\n\nPrüfe jeden Einwand an der Norm-Bibliothek, arbeite nur berechtigte ein, verwirf unberechtigte begründet, und liefere den finalen Beschlusstext, die finale Chat-Antwort und den Titel.`,
        },
      ],
      schema: RECONCILE_SCHEMA,
      name: 'beschluss-reconcile',
      userId,
      spellcheckFields: ['reply', 'content', 'title'],
    })
    const content = String(final?.content ?? '').replace(/\\n/g, '\n')
    if (!content.trim()) return { ...draft, issues: issues.length } // Reconciler hat den Text verloren -> Entwurf behalten
    return {
      reply: String(final.reply ?? draft.reply).replace(/\\n/g, '\n'),
      writeContent: true,
      content,
      title: String(final.title ?? '').trim() || draft.title,
      issues: issues.length,
    }
  } catch (e) {
    console.warn('beschluss-reconcile fehlgeschlagen, Entwurf bleibt:', e.message)
    return { ...draft, issues: issues.length }
  }
}

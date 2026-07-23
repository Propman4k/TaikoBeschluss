# Ubiquitous Language — TaikoBeschluss

Glossar der Domänen-Begriffe. Keine Implementierungsdetails.

## Beschluss

Ein Gesellschafterbeschluss einer Gesellschaft. Besteht aus dem generierten
**Rahmen** (Einleitung, Gesellschafterliste, Schlussformel, Unterschriftsblöcke)
und dem variablen **Inhalt** (die eigentlichen Beschlusspunkte). Nur der Inhalt
wird bearbeitet — per Chat/KI oder direkt.

## Entwurf

Beschluss in Bearbeitung. Inhalt änderbar, noch keine Unterschriften möglich.

## Freigegeben

Der Beschluss wurde zur Unterschrift freigegeben. Erst ab jetzt existieren
Unterschriftszeilen. Inhalt bleibt bewusst weiter änderbar; bestehende
Unterschriften bleiben dabei erhalten.

## Abgeschlossen

**Abgeleiteter Zustand, kein eigener Status:** ein freigegebener Beschluss,
bei dem alle Gesellschafter unterschrieben haben. Ein Beschluss kann aus
„Abgeschlossen" wieder herausfallen, wenn eine Unterschrift entfernt wird.

Der Moment des Abschlusses (letzte fehlende Unterschrift geht ein) löst die
**Drive-Ablage** aus.

## Drive-Ablage

Das fertige Beschluss-PDF wird in Google Drive abgelegt: im zentralen
Beschluss-Ordner, darunter ein Unterordner je Gesellschaft. Der Unterordner
ist der Gesellschaft dauerhaft zugeordnet (Umbenennung der Gesellschaft oder
des Ordners ändert die Zuordnung nicht). Wird ein bereits abgelegter Beschluss
erneut abgeschlossen oder nachbearbeitet, wird **dieselbe Datei überschrieben**
— der Drive-Link bleibt stabil, es entstehen keine Duplikate, in Drive wird
nie gelöscht.

Dateiname: `<Nummer> – <Titel>.pdf` (z.B. „2026-03 – Gewinnverwendung 2025.pdf").

## Gesellschafter

Zentral gepflegte Beteiligte (Gesellschaft oder Person), wiederverwendbar über
mehrere Gesellschaften. Für jeden Gesellschafter unterschreibt genau ein
**Unterzeichner** (natürliche Person, dem Login per E-Mail zugeordnet).

## Unterzeichner

Die natürliche Person, die für einen Gesellschafter zeichnet. Zugang zum Tool
hat, wer auf der Whitelist steht oder als Unterzeichner hinterlegt ist.

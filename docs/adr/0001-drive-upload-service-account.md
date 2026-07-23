# 0001 — Drive-Upload über Service Account

Datum: 2026-07-23
Status: akzeptiert (revidiert am selben Tag: Ziel muss eine Geteilte Ablage sein)

## Kontext

Abgeschlossene Beschlüsse sollen als PDF automatisch in einen Google-Drive-
Ordner (Unterordner je Gesellschaft) abgelegt werden. Der bestehende
Google-OAuth-Login liefert nur ein `id_token` für die Anmeldung — kein
Drive-Zugriff, keine Refresh-Tokens. Der Server braucht also einen eigenen,
headless funktionierenden Zugang zu Drive.

Geprüfte Alternativen:

1. **Service Account**, Ziel-Ordner wird einmalig mit der SA-E-Mail geteilt.
2. **OAuth-Refresh-Token des Users** (voller `drive`-Scope nötig, da der
   Ordner nicht von der App erstellt wurde; Token in `.env`).
3. **Shared Drive** mit Service Account als Mitglied.

## Entscheidung

Service Account (Variante 1), Ziel-Ordner in einer **Geteilten Ablage**
(Shared Drive), SA als Inhaltsverwalter; Ordner-ID kommt aus der ENV.

Ursprünglich war ein normaler "Meine Ablage"-Ordner geplant (Variante 1 pur).
Das scheiterte im ersten Live-Test am 2026-07-23 hart: Google gibt Service
Accounts inzwischen **null eigene Speicher-Quota** ("Service Accounts do not
have storage quota", 403 beim Anlegen) — ein SA kann in "Meine Ablage" keine
Dateien mehr besitzen, auch nicht in einem mit ihm geteilten Ordner. Damit
blieb von Variante 1 nur die Kombination mit Variante 3.

## Begründung

- Läuft headless auf der NAS, kein Token-Refresh, das still brechen kann
  (Google invalidiert User-Refresh-Tokens u.a. bei Passwortwechsel).
- Kein Consent-Flow, keine sensiblen Scopes am User-Account.
- Gegen Domain-wide Delegation (die zweite Rettung fürs "Meine Ablage"-Ziel):
  gilt technisch für alle Drives der Domain — zu breiter Hebel für ein Tool.

## Konsequenzen

- Der Beschluss-Ordner liegt in einer Geteilten Ablage; die ursprüngliche
  "Meine Ablage"-URL gilt nicht mehr. Dateien gehören der Ablage, nicht
  einer Person — kein Quota-Thema, Team-Zugriff über Ablage-Mitgliedschaft.
- Alle Drive-API-Calls brauchen `supportsAllDrives=true` (Suche zusätzlich
  `includeItemsFromAllDrives=true`).
- Einmalige Einrichtung nötig: SA im Google-Cloud-Projekt anlegen, Drive API
  aktivieren, JSON-Key als ENV bereitstellen, SA als Inhaltsverwalter der
  Geteilten Ablage hinzufügen.

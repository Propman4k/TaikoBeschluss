# 0001 — Drive-Upload über Service Account

Datum: 2026-07-23
Status: akzeptiert

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

Service Account (Variante 1). Der Beschluss-Ordner wird mit der SA-E-Mail
als Editor geteilt; Ordner-ID kommt aus der ENV.

## Begründung

- Läuft headless auf der NAS, kein Token-Refresh, das still brechen kann
  (Google invalidiert User-Refresh-Tokens u.a. bei Passwortwechsel).
- Kein Consent-Flow, keine sensiblen Scopes am User-Account.
- Shared Drive wäre quota-technisch sauberer, erfordert aber Umzug des
  bestehenden Ordners und ändert dessen URL.

## Konsequenzen

- Hochgeladene Dateien gehören dem Service Account und zählen gegen dessen
  eigene 15-GB-Quota. Für Beschluss-PDFs (wenige hundert KB) auf Jahre
  irrelevant — wird die Quota je erreicht, ist der Umzug auf ein Shared
  Drive (Variante 3) der Upgrade-Pfad.
- Einmalige Einrichtung nötig: SA im Google-Cloud-Projekt anlegen,
  JSON-Key als ENV bereitstellen, Ordner mit SA-E-Mail teilen.
- Löschen/Verschieben der Dateien in Drive kann nur der SA (oder ein
  Drive-Admin über die Ordnerfreigabe).

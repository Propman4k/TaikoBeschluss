# ACHTUNG: Live-Daten — NIE rm -rf auf dieses Verzeichnis

Hier liegen die produktive SQLite-DB (taikobeschluss.db + -wal/-shm) und die
Unterschriften-PNGs (signatures/) — rechtlich relevante, unterschriebene
Gesellschafterbeschluesse.

- Loeschen nur gezielt per Datei-Pfad, nie pauschal.
- Backups: `npm run backup --prefix server` →
  ~/Library/Application Support/TaikoBeschluss/backups/ (+ Google-Drive-Mirror).
- Restore-Anleitung: README.md im Backup-Ordner.

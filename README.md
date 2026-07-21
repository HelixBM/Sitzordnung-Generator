# Sitzordnung Randomizer

Eine responsive Browser-App zum Erstellen, Verschieben und Randomisieren von Sitzordnungen.

## Funktionen

- Hufeisen/U-Form, Reihen mit Mittelgang und Gruppentische
- Standardmäßig Doppeltische; Einzeltische können hinzugefügt werden
- Statische Tisch- und Platz-IDs
- Zufallszahlen von 1 bis maximal 30 ohne doppelte Vergabe
- Zufällig verteilte leere Plätze
- Tische per Maus oder Touch verschieben und drehen
- Einzelne Plätze durch Anklicken tauschen
- Lokales Speichern des aktuellen Arbeitsstands
- Export als PNG und Druckansicht für PDF

## GitHub Pages

Das Repository enthält bereits den Workflow `.github/workflows/deploy-pages.yml`.

1. Repository zu GitHub pushen.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Bei jedem Push auf `main` wird die App gebaut und veröffentlicht.

Die statische Pages-Version kann lokal mit folgendem Befehl gebaut werden:

```bash
npm install
npm run build:github-pages
```

## Verwendung

Die Klassengröße eingeben, eine Vorlage auswählen und **Neue Sitzordnung anlegen** klicken. Mit **Neu erzeugen** werden die Schülernummern neu verteilt. Zum manuellen Tauschen zwei Plätze nacheinander anklicken.

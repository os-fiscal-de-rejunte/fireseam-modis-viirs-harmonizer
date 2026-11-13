# Pitch script (30 seconds)

About 75 spoken words. Captions are the on-screen text.

| Time | Picture | Voice-over | Caption |
|---|---|---|---|
| 0-5 s | Globe on 2020, detections lighting up over the Pantanal; the sonification of that year plays | (no voice; the sound of the weeks of 2020 as notes) | Pantanal, 2020 |
| 5-15 s | Yearly totals view (bottom strip, switch to "Yearly totals"): the raw MODIS and VIIRS lines and the jump at 2012 | "Two satellites watch fire from space. They see it differently, so joining their records makes a jump in 2012 that is not real." | Two sensors, one artificial jump in 2012 |
| 15-25 s | Switch back to "Calendar" (harmonized weekly heatmap), then turn on Ghosts only on the globe | "We convert MODIS into VIIRS-equivalent weekly counts. Tested one year at a time, weekly error is 217.56 against 240.27 for a monthly ratio, ahead in 9 of 14 years. Ghosts show what one satellite missed." | Weekly error 217.56 vs 240.27, ahead in 9 of 14 years. 52.3% of S-NPP detections had no Aqua match in the same overpass, 2012-2021 |
| Optional beat | Select an area on the globe; the calendar marks unusual weeks and the critical period; click Download CSV | "Select any area and its calendar and unusual weeks follow, assuming one conversion factor for the whole region. Download it as CSV." | Your area, its unusual weeks, CSV |
| 25-30 s | Outlook tab on the globe | "MODIS is planned to retire. This bridges 26 years of fire, and the outlook looks ahead." | 2001-2026, one calendar |

Spoken word count: 74, not counting the optional area beat, which is for a longer demo and is not part of the 30 seconds.

## Numbers used

| Number | Source file | Key |
|---|---|---|
| 2020 | `web/public/data/metrics.json` | `events[year=2020]`, `pairing.by_year[year=2020]` |
| 52.3% | `web/public/data/metrics.json` | `pairing.by_year`: sum(`viirs_unmatched` x `viirs_n`) / sum(`viirs_n`) over 2012-2021 |
| 217.56 | `web/public/data/metrics.json` | `weekly_total.mae_model` |
| 240.27 | `web/public/data/metrics.json` | `weekly_total.mae_baseline` |
| 9 of 14 years | `web/public/data/metrics.json` | `weekly_total.years_won`, `weekly_total.years` |
| 2012 jump | `web/public/data/metrics.json` | `by_year[year=2012].ratio_raw` (raw VIIRS to MODIS ratio, 3.4 to 4.4 across 2012-2025, as a yearly ratio); the first year with VIIRS in `web/public/data/calendar.json` `meta.coverage.viirs` |
| 26 years | `web/public/data/calendar.json` | `weeks` span 2001 to 2026 |

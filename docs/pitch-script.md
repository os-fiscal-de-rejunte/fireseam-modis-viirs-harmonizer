# Pitch script (30 seconds)

About 71 spoken words. Captions are the on-screen text.

| Time | Picture | Voice-over | Caption |
|---|---|---|---|
| 0-5 s | Globe on 2020, detections lighting up over the Pantanal; the sonification of that year plays | (no voice; the sound of the weeks of 2020 as notes) | Pantanal, 2020 |
| 5-14 s | Yearly totals view (bottom strip, switch to "Yearly totals"): the raw MODIS and VIIRS lines and the jump at 2012 | "Two satellites watch fire from space. They see it differently, so joining their records makes a jump in 2012 that is not real." | Two sensors, one artificial jump in 2012 |
| 14-21 s | Switch back to "Calendar" (harmonized weekly heatmap), then turn on Ghosts only on the globe | "We convert MODIS into VIIRS-equivalent weekly counts. Tested one year at a time, it beats a monthly ratio in 9 of 14 years." | Weekly error 217.56 vs 240.27, ahead in 9 of 14 years. 52.3% of S-NPP detections had no Aqua match in the same overpass, 2012-2021 |
| 21-26 s | Press Select area and drag a rectangle on the globe; the calendar marks unusual weeks and the critical period | "Select any area: its calendar, unusual weeks and critical period follow." | Your area, its unusual weeks, its critical period. One conversion factor for the whole region |
| 26-30 s | Outlook tab on the globe | "NASA plans to end MODIS science in 2027. This bridges 26 years of fire." | MODIS science ends in 2027 (NASA). 2001-2026, one calendar |

Spoken word count: 71 (23 + 23 + 11 + 14 across the four voiced rows).

The voice-over no longer says the two error figures or the ghost line; they stay in the caption.

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
| 2027 | NASA Science, editor's note in "Terra: The End of An Era" (see Sources) | end of science projected: Terra February 2027, Aqua September 2027 |

## Sources

Read on 13 November 2026.

- NASA Science, "Terra: The End of An Era", 29 December 2025, editor's note: end of science activities projected for Terra in February 2027 and Aqua in September 2027. https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era/
- NASA Earthdata, data alert "Transition from MODIS to VIIRS", 2 May 2025: Terra and Aqua begin shutting down operations in late 2026 or early 2027 and MODIS data will no longer be collected. https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs
- NASA LAADS DAAC, "MODIS to VIIRS Transition": decommissioning plan and continuity products. https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition
- INPE, Programa Queimadas, "Perguntas Frequentes", item 7 ("O que é o satélite de referência"): Aqua MODIS is the reference satellite since July 2002; S-NPP VIIRS will replace it when Aqua stops. https://data.inpe.br/queimadas/faq/

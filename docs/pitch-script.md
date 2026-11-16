# Pitch script (30 seconds)

One sentence: **FireSeam helps fire managers see when a week of burning is out of the
ordinary, by joining NASA's MODIS and VIIRS fire detections into one weekly calendar from 2001
to today.**

70 spoken words, about 28 seconds at a calm pace. The hard limit is 30 seconds: a longer video
makes the project ineligible for Global Judging, so the final cut should end at 29 seconds or
less. Captions are the on-screen text and double as the English subtitles.

| Time | Beat | Picture | Voice-over | Caption |
|---|---|---|---|---|
| 0-3 s | Who we are | The planet cover, turning slowly, the five regions listed | "We are Os Fiscal de Rejunte." | Os Fiscal de Rejunte, São Paulo. NASA Space Apps 2026 |
| 3-8 s | Challenge and what moved us | Click Pantanal, the globe flies in. Bottom strip on "Yearly totals": the raw MODIS and VIIRS lines and the jump at 2012 | "NASA's MODIS fire record is ending. Its successor, VIIRS, counts far more fires." | Challenge: Harmonization of MODIS and VIIRS Hot Spots. MODIS science projected to end in 2027 (NASA) |
| 8-12 s | Project name and hook | Switch to "Calendar": the harmonized weekly heatmap, 2001 to 2026 | "FireSeam joins both into one weekly calendar since 2001." | FireSeam. One calendar, 2001-2026 |
| 12-22 s | How it works, prototype, NASA data | Right panel "How it was checked", then press Select area and drag a rectangle: the calendar marks the unusual weeks and the critical period | "With NASA FIRMS data we put both on one scale, and show where that failed. Select any area: its unusual weeks appear." | NASA FIRMS: MODIS C6.1 and VIIRS S-NPP 375 m. Tested one year at a time. Passed in 3 of 5 regions; the other two are labelled |
| 22-29 s | Impact and what comes next | Back to the cover: five regions, each with its validation state. Then open Briefing | "Five regions, five continents. A fire manager sees, on one page, when a week is out of the ordinary." | One-page briefing, English and Portuguese. Any region can be added |

Spoken word count: 70 (6 + 13 + 10 + 22 + 19).

## How it follows the 30-second model

| Model beat | Model time | Here |
|---|---|---|
| Introduce yourselves and the team name | 0:00-0:02 | 0-3 s |
| The challenge and what inspired you | 0:02-0:05 | 3-8 s |
| Project name and a hook | 0:05-0:10 | 8-12 s |
| How it works, the prototype on screen, NASA data | 0:10-0:20 | 12-22 s |
| Future and impact | 0:20-0:30 | 22-29 s |

The prototype is on screen from the first second. The voice names NASA twice and FIRMS once.
No error figure is spoken; the validation result stays in the caption.

## Recording notes

- Record the screen first, without sound, following the Picture column. Record the voice
  separately and lay it over; trim the picture to the voice, not the reverse.
- Rehearse the clicks: cover, Pantanal, Yearly totals, Calendar, Select area, cover, Briefing.
  The fly-in from the cover takes part of the 3-8 s beat, so click as the first sentence ends.
- Keep the app's sound off in the recording, or under the voice at low volume.
- Check the challenge title in the caption against the challenge page before recording.
- Upload where anyone can watch without signing in, and open the link in a private window
  before pasting it into the submission form.

## What not to say

- "Global coverage": it is five regions.
- "Early warning system": the alert is a retrospective rule on data that ends on
  11 November 2026.
- "Risk" or "burned area": the counts are satellite detections.
- That the conversion works everywhere: it passed in three of five regions.

## Numbers used

| Number | Source file | Key |
|---|---|---|
| 2001 to 2026 | `web/public/data/calendar.json` | `weeks` span |
| Five regions | `web/public/data/regions.json` | one row per region |
| 3 of 5 regions passed | `web/public/data/regions.json` | acceptance state of each row: Pantanal, Iberia and Southern Africa accepted; Indonesia and Northern Australia baseline |
| Jump at 2012 | `web/public/data/metrics.json` | `by_year[year=2012].ratio_raw`; first year with VIIRS in `calendar.json` `meta.coverage.viirs` |
| "counts far more fires" | `web/public/data/metrics.json` | `by_year[].ratio_raw`, raw VIIRS to MODIS yearly ratio in the Pantanal, 3.4 to 4.4 across 2012-2025 |
| 2027 | NASA Science, editor's note in "Terra: The End of An Era" (see Sources) | end of science projected: Terra February 2027, Aqua September 2027 |

## Sources

Read on 13 November 2026.

- NASA Science, "Terra: The End of An Era", 29 December 2025, editor's note: end of science activities projected for Terra in February 2027 and Aqua in September 2027. https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era/
- NASA Earthdata, data alert "Transition from MODIS to VIIRS", 2 May 2025: Terra and Aqua begin shutting down operations in late 2026 or early 2027 and MODIS data will no longer be collected. https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs
- NASA LAADS DAAC, "MODIS to VIIRS Transition": decommissioning plan and continuity products. https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition
- INPE, Programa Queimadas, "Perguntas Frequentes", item 7 ("O que é o satélite de referência"): Aqua MODIS is the reference satellite since July 2002; S-NPP VIIRS will replace it when Aqua stops. https://data.inpe.br/queimadas/faq/

# Slides outline (7 slides)

## 1. Title

- **Headline:** One fire calendar for the Pantanal, 2001-2026
- Challenge: Harmonization of MODIS and VIIRS Hot Spots
- Team: Os Fiscal de Rejunte
- **Capture:** the globe on the 2020 season, with the title overlaid.

## 2. The problem

- **Headline:** Two sensors, one artificial jump in 2012
- MODIS (about 1 km, since 2000) and VIIRS (375 m, since 2012) detect fire differently.
- Stacking the records makes fire look like it jumped in 2012; raw VIIRS to MODIS yearly ratio
  is 3.4 to 4.4 across 2012-2025 (`metrics.json`, `by_year.ratio_raw`).
- NASA projects the end of science activities for Terra in February 2027 and for Aqua in September 2027 (NASA Science, editor's note in "Terra: The End of An Era").
- INPE's Programa Queimadas uses Aqua MODIS as its reference satellite since July 2002 and states that S-NPP VIIRS will replace it when Aqua stops, with the two series to be made compatible (INPE FAQ, item 7).
- **Capture:** the "Yearly totals" view in the bottom strip, with raw MODIS and VIIRS and the step at 2012 visible.

## 3. The solution

- **Headline:** MODIS converted to VIIRS-equivalent weekly counts
- 1352 weeks: 753 observed, 579 estimated, 20 gaps (`calendar.json`).
- Missing coverage is a gap, never a zero; two 2024 S-NPP outages are treated as estimated.
- Select an area on the globe: its calendar, unusual weeks and critical period follow, and the
  CSV downloads. It assumes one conversion factor for the whole region.
- **Capture:** "Calendar" view (harmonized weekly heatmap) with observed, estimated and gap weeks distinguished.

## 4. Method and validation

- **Headline:** Poisson GLM, tested one year at a time
- Regional weekly totals; Terra-only model for the pre-Aqua era.
- Accepted only if lower mean error than a monthly-ratio baseline and at least 8 of 14 years won.
- A cell-level gradient boosting model was tried first and rejected by the same rule.
- The design was chosen after that failure on the same folds, so the score is indicative.
- **Capture:** per-year error chart, model vs baseline, from `metrics.json` `by_year`.

## 5. Results

- **Headline:** 217.56 vs 240.27 weekly error, ahead in 9 of 14 years
- A modest gain: about 9%, mostly from the megafire years 2024 and 2020.
- Terra-only model: 314.34 vs 325.38, ahead in 8 of 14 years, exactly the threshold.
- The baseline wins 2012, 2019, 2021, 2022 and 2025; we report that.
- **Capture:** results table from the README.

## 6. Ghosts and events

- **Headline:** What one satellite saw and the other did not
- Ghosts are detections only Aqua or only S-NPP saw in the same overpass (2 km, 180 min).
- 52.3% of S-NPP detections had no Aqua match in the same overpass, 2012-2021 (pooled); 11.7% of Aqua detections had no S-NPP match.
- 2020 fire events: 7316 from MODIS, 12624 from VIIRS.
- **Capture:** globe with the ghost-only filter on, 2020.

## 7. Outlook and limits

- **Headline:** Looking ahead, with honest limits
- PYRO forecast outlook: ROC AUC 0.7506, recall 0.3955; 498 of 1140 cells released.
- It projects detection probability by season, not ignition.
- Limits: a bounding box, not the biome polygon; pre-2012 values are estimates; S-NPP only.
- **Capture:** Outlook tab on the globe for a fire-season month.

## Sources

Read on 13 November 2026.

- NASA Science, "Terra: The End of An Era", 29 December 2025, editor's note: end of science activities projected for Terra in February 2027 and Aqua in September 2027. https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era/
- NASA Earthdata, data alert "Transition from MODIS to VIIRS", 2 May 2025: Terra and Aqua begin shutting down operations in late 2026 or early 2027 and MODIS data will no longer be collected. https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs
- NASA LAADS DAAC, "MODIS to VIIRS Transition": decommissioning plan and continuity products. https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition
- INPE, Programa Queimadas, "Perguntas Frequentes", item 7 ("O que é o satélite de referência"): Aqua MODIS is the reference satellite since July 2002; S-NPP VIIRS will replace it when Aqua stops. https://data.inpe.br/queimadas/faq/
